// init global variables
require("../dom");

var version = require("../../version");
var Const = require("../const");
var Polyfill = require("../polyfill");
var { hash, now, uniq } = require("./util");
var Parser = require("./parser");
var Generated = require("./generated");
var { modeRegistry, modeNames, defaultMode, startMode } = require("./mode");

function mapAttributeType(type) {
	switch(type) {
		case "": return Const.BUILDER_TYPE_NONE;
		case "@": return Const.BUILDER_TYPE_PROP;
		case "&": return Const.BUILDER_TYPE_STYLE;
		case "+": return Const.BUILDER_TYPE_ON;
		case "$": return Const.BUILDER_TYPE_CREATE_WIDGET;
		case "~": return Const.BUILDER_TYPE_UPDATE_WIDGET;
		case "$$": return Const.BUILDER_TYPE_EXTEND_WIDGET;
	}
}

function Transpiler(options) {
	this.options = Polyfill.assign({env: ["none"]}, options || {});
	// separate mode and mode attributes
	if(this.options.mode) {
		var at = this.options.mode.indexOf("@");
		if(at != -1) {
			var attrs = this.options.mode.substr(at + 1).split(",");
			this.options.mode = this.options.mode.substring(0, at);
			if(typeof this.options.modeAttributes != "object") this.options.modeAttributes = {};
			attrs.forEach(attr => {
				if(attr.charAt(0) == "!") this.options.modeAttributes[attr.substr(1)] = false;
				else this.options.modeAttributes[attr] = true;
			});
		}
	}
	// calculate environments
	if(!Array.isArray(this.options.env)) this.options.env = [this.options.env];
	if(this.options.env.length == 1 && this.options.env[0] == "none") {
		this.nextVar = Transpiler.prototype.nextVarName.bind(this);
	} else {
		this.options.env.forEach(env => {
			if(["none", "amd", "commonjs"].indexOf(env) == -1) {
				throw new Error("Unknown env '" + env + "'.");
			}
		});
	}
	// update nextVar functions for latin-only generation
	if(this.options.latin) {
		this.nextVar = this.nextVarName = Transpiler.prototype.nextLatinVarName.bind(this);
	}
}

/**
 * @since 0.128.0
 */
Transpiler.transpile = function(options, source){
	return new Transpiler(options).transpile(source);
};

/**
 * @since 0.49.0
 */
Transpiler.prototype.nextId = function(){
	return this.count++;
};

/**
 * @since 0.78.0
 */
Transpiler.prototype.nextVarName = function(){
	var num = this.count++ % 1521;
	var s = "";
	for(var i=0; i<2; i++) {
		var t = num % 39;
		s = String.fromCharCode(0x561 + t) + s;
		num = Math.floor((num - t) / 39);
	}
	return s;
};

/**
 * @since 0.119.0
 */
Transpiler.prototype.nextLatinVarName = function(){
	var num = this.count++ % 1296;
	var s = "";
	for(var i=0; i<2; i++) {
		var t = num % 36;
		s = (t < 10 ? t : String.fromCharCode(97 + t - 10)) + s;
		num = Math.floor((num - t) / 36);
	}
	return "$_" + s;
};

/**
 * @since 0.16.0
 */
Transpiler.prototype.startMode = function(mode, attributes){
	var currentParser = startMode(mode, this, this.parser, this.source, attributes, this.currentMode && this.currentMode.parser);
	this.currentMode = {
		name: modeRegistry[mode].name,
		parser: currentParser,
		options: currentParser.options
	};
	this.modes.push(this.currentMode);
	return currentParser;
};

/**
 * @since 0.16.0
 */
Transpiler.prototype.endMode = function(){
	var ret = this.modes.pop().parser;
	ret.end();
	this.currentMode = this.modes[this.modes.length - 1];
	if(this.currentMode) this.parser.options = this.currentMode.options;
	return ret;
};

/**
 * @since 0.124.0
 */
Transpiler.prototype.parseImpl = function(modeId, input, parentParser){
	var parser = new Parser(input, (parentParser || this.parser).position);
	var source = this.source.fork();
	var mode = startMode(modeId, this, parser, source, {inAttr: true});
	if(mode.observables) {
		parser.parseTemplateLiteral = expr => {
			var parsed = this.parseCode(expr, parser);
			mode.observables.push(...parsed.observables);
			mode.maybeObservables.push(...parsed.maybeObservables);
			return parsed.source;
		};
	}
	mode.start();
	while(parser.index < input.length) {
		mode.parse(() => source.addSource("<"), () => {});
	}
	mode.end();
	return {mode, source};
};

/**
 * @since 0.42.0
 */
Transpiler.prototype.parseCode = function(input, parentParser){
	var {mode, source} = this.parseImpl(defaultMode, input, parentParser);
	source = source.toString();
	var observables = mode.observables ? uniq(mode.observables) : [];
	var maybeObservables = mode.maybeObservables ? uniq(mode.maybeObservables) : [];
	var ret = {
		source, observables, maybeObservables,
		toValue: () => observables.length || maybeObservables.length ? `${this.feature("coff")}(${ret.toSpreadValue()})${observables.length ? `.d(${this.arguments}, ${this.context}, ${observables.join(", ")})` : ""}${maybeObservables.length ? `.m(${this.arguments}, ${this.context}, ${maybeObservables.join(", ")})` : ""}` : source,
		toAttrValue: () => observables.length || maybeObservables.length ? `${this.feature("bo")}(${ret.toSpreadValue()}, [${observables.join(", ")}]${maybeObservables.length ? `, [${maybeObservables.join(", ")}]` : ""})` : source,
		toSpreadValue: () => this.options.es6 ? `() => ${source}` : `function(){return ${source}}.bind(this)`
	};
	return ret;
};

/**
 * @since 0.124.0
 */
Transpiler.prototype.parseText = function(input, parentParser){
	return this.parseImpl(modeNames.__comment, input, parentParser).mode.values.join(" + ");
};

/**
 * @since 0.51.0
 */
Transpiler.prototype.parseTemplateLiteral = function(expr, parser){
	return this.parseCode(expr, parser).source;
};

/**
 * Sets the parser's template literal parser to @{link parseTemplateLiteral}.
 * @since 0.51.0
 */
Transpiler.prototype.updateTemplateLiteralParser = function(){
	this.parser.parseTemplateLiteral = this.parseTemplateLiteral.bind(this);
};
	
/**
 * Inserts a semicolon after a tag creation if needed.
 * @since 0.22.0
 */
Transpiler.prototype.addSemicolon = function(){
	if(this.currentMode.options.code) {
		var skip = this.parser.skip();
		var peek = this.parser.peek();
		if(!/[;:,.)\]}&|=]/.test(peek)) this.source.push(";");
		if(skip) this.source.push(skip);
	} else {
		this.source.push(";");
	}
};

/**
 * Closes a scope and optionally ends the current mode and restores the
 * previous one.
 * @since 0.29.0
 */
Transpiler.prototype.close = function(tagName){
	if(tagName !== undefined) {
		// closing a tag, not called as EOF
		var closeInfo = this.tags.pop();
		if(closeInfo.tagName && closeInfo.tagName != tagName) {
			this.parser.errorAt(closeInfo.position, "Tag `" + closeInfo.tagName + "` is not closed properly (used `</" + tagName + ">` instead of `</" + closeInfo.tagName + ">`).");
		}
		if(closeInfo.mode) {
			var mode = this.endMode();
			if(mode.chainable && closeInfo.hasBody) {
				//TODO
			}
		}
		this.inherit.pop();
		this.level--;
	}
	if(this.closing.length) {
		this.source.push(this.closing.pop());
		this.addSemicolon();
	}
};

/**
 * @since 0.29.0
 */
Transpiler.prototype.open = function(){
	if(this.parser.peek() == "/") {
		this.parser.index++;
		var result = this.parser.find([">"], true, false); // skip until closed
		this.close(result.pre);
	} else if(this.parser.peek() == "!") {
		this.parser.index++;
		var rest = this.parser.input.substr(this.parser.index);
		if(Polyfill.startsWith.call(rest, "COMMENT ")) {
			this.warn("The `<!COMMENT ...>` tag is deprecated. Use `<!// ...` or `<!/* ... */>` instead.");
			this.parser.index += 8;
			this.source.push("/*" + this.parser.findSequence(">", true).slice(0, -1) + "*/");
		} else {
			let next = this.parser.input.substr(this.parser.index, 2);
			if(next == "--") {
				// xml comment
				this.parser.index += 2;
				this.source.addSource(`${this.feature("comment")}(`);
				this.source.addContext();
				this.source.addSource(`, ${this.parseText(this.parser.findSequence("-->", true).slice(0, -3))})`);
				this.addSemicolon();
			} else if(next == "/*") {
				// code comment
				this.source.push(this.parser.findSequence("*/>", true).slice(0, -1));
			} else if(next == "//") {
				// inline code comment
				this.source.push(this.parser.findSequence("\n", false));
			} else {
				this.source.push("<");
			}
		}
	} else if(this.currentMode.options.children === false && this.parser.peek() != "#") {
		throw new Error("Mode " + this.currentMode.name + " cannot have children");
	} else {
		var position = this.parser.position;
		var parser = this.parser;
		var skipped = "";
		var skip = () => (skipped = parser.skipImpl({comments: true, strings: false}));
		var create = true; // whether a new element is being created
		var update = true; // whether the element is being updated, only considered if create is false
		var append = true; // whether the element should be appended to the current element after its creation
		var query = false; // whether the element should be from a query
		var clone = false; // whether the element should be cloned
		var parent; // element that the new element will be appended to, if not null
		var element; // element that will be used, if any
		var all;
		var arg;
		var dattributes = {}; // attributes used to give directives to the transpiler, not used at runtime
		var rattributes = []; // attributes used at runtime to modify the element
		var iattributes = []; // attributes used at runtime that are created using interpolation syntax
		var sattributes = []; // variable name of the attributes passed using the spread syntax
		var newMode = undefined;
		var currentNamespace = null;
		var currentInheritance = null;
		var currentClosing = [];
		var forms = [];
		var computed = false;
		var originalTagName, tagName = "", tagNameString;
		var slotName;
		var optional = !!this.parser.readIf("?");
		this.updateTemplateLiteralParser();
		if(tagName = this.parser.readComputedExpr()) {
			tagName = tagNameString = this.parseCode(tagName).source;
			computed = true;
		} else {
			originalTagName = tagName = this.parser.readTagName(true);
			if(this.options.capitalIsWidget && tagName.charCodeAt(0) >= 65 && tagName.charCodeAt(0) <= 90) {
				computed = true;
				tagNameString = tagName;
			}
		}
		skip();
		if(this.parser.peek() == "(") {
			arg = this.parser.skipEnclosedContent(true);
			skip();
		}
		var next = false;
		while(!this.parser.eof() && (next = this.parser.peek()) != ">" && next != "/") {
			if(!/[\n\t ]/.test(skipped)) this.parser.error("Space is required between attribute names.");
			this.updateTemplateLiteralParser();
			var attr = {
				optional: !!this.parser.readIf("?"),
				negated: !!this.parser.readIf("!"),
				type: this.parser.readAttributePrefix() || "",
				beforeName: skipped
			};
			if(this.isSpreadAttribute()) {
				//TODO assert not optional nor negated
				sattributes.push({type: attr.type, expr: this.parser.readSingleExpression(false, true), space: skipped});
				skip();
			} else {
				var content = this.parseAttributeName(false);
				if(this.parser.readIf("{")) {
					if(attr.type == ":" || attr.type == "*") this.parser.error("Cannot interpolate this type of attribute.");
					attr.before = content;
					attr.inner = [];
					do {
						var curr, before = skip();
						if(this.isSpreadAttribute()) {
							attr.inner.push(curr = {spread: true, expr: this.parser.readSingleExpression(false, true)});
						} else {
							curr = this.parseAttributeName(true);
							this.compileAttributeParts(curr);
							attr.inner.push(curr);
						}
						curr.beforeValue = before;
						curr.afterValue = skip();
					} while((next = this.parser.read()) == ",");
					if(next != "}") this.parser.error("Expected '}' after interpolated attributes list.");
					attr.after = this.parseAttributeName(false);
					this.compileAttributeParts(attr.before);
					this.compileAttributeParts(attr.after);
				} else if(content.parts.length == 0 && attr.type != "$") {
					this.parser.error("Cannot find a valid attribute name.");
				} else {
					Polyfill.assign(attr, content);
				}
				// read value
				skip();
				if(this.parser.peek() == "=") {
					attr.afterName = skipped;
					this.parser.index++;
					attr.beforeValue = skip();
					this.parser.parseTemplateLiteral = null;
					var value = this.parser.readAttributeValue();
					var parsed = this.parseCode(value);
					if(attr.type == "+") {
						var source = parsed.source;
						if(source.charAt(0) == "{" && source.charAt(source.length - 1) == "}") {
							attr.value = this.options.es6 ? `(event, target) => ${source}` : `function(event, target)${source}.bind(this)`;
						} else {
							attr.value = source;
						}
					} else {
						attr.value = parsed.toAttrValue();
					}
					attr.sourceValue = parsed.source;
					skip();
				}
				if(attr.inner) {
					if(!Object.prototype.hasOwnProperty.call(attr, "value")) {
						attr.value = this.getDefaultAttributeValue(attr);
					}
					iattributes.push(attr);
				} else {
					this.compileAttributeParts(attr);
					switch(attr.type) {
						case ":":
							if(attr.computed) this.parser.error("Compile-time attributes cannot be computed.");
							if(!Object.prototype.hasOwnProperty.call(attr, "value")) attr.value = !attr.negated;
							if(Object.prototype.hasOwnProperty.call(dattributes, attr.name)) {
								if(dattributes[attr.name] instanceof Array) {
									dattributes[attr.name].push(attr.value);
								} else {
									var a = dattributes[attr.name] = [dattributes[attr.name], attr.value];
									a.toString = () => `[${a.join(", ")}]`;
								}
							} else {
								dattributes[attr.name] = attr.value;
							}
							rattributes.push({spacer: `${attr.beforeName}/*${attr.name}${attr.afterName || ""}=${attr.beforeValue || ""}${attr.value}*/`});
							break;
						case "*": {
							let add = false;
							let temp;
							let start = attr.parts[0];
							if(!start || start.computed) this.parser.error("First part of bind attributes cannot be computed.");
							let column = start.name.indexOf(":");
							if(column == -1) column = start.name.length;
							let name = start.name.substring(0, column);
							switch(name) {
								case "next":
								case "prev":
									this.warn("Attributes `*next` and `*prev` are deprecated. Use `~next` and `~prev` instead.");
									break;
								case "show":
								case "hide":
									this.warn("Attributes `*show` and `*hide` are deprecated. Use `~show` and `~hide` instead.");
									break;
								case "number":
									start.name += ":number";
								case "checkbox":
								case "color":
								case "date":
								case "email":
								case "file":
								case "password":
								case "radio":
								case "range":
								case "text":
								case "time":
									temp = name;
								case "form":
								case "value":
									if(!Object.prototype.hasOwnProperty.call(attr, "value")) this.parser.error("Value for form attribute is required.");
									if(column == start.name.length || column == start.name.length - 1) attr.parts.shift();
									else start.name = start.name.substr(column + 1);
									if(start.name.charAt(0) == ":") start.name = ":" + start.name;
									this.compileAttributeParts(attr);
									forms.push({
										info: this.stringifyAttribute(attr),
										value: attr.value,
										type: temp,
										ref: attr.sourceValue || attr.value
									});
									break;
								default:
									this.parser.error("Unknown bind attribute '" + name + "'.");
							}
							if(add) this.compileAttributeParts(attr);
							else break;
						}
						default:
							if(!Object.prototype.hasOwnProperty.call(attr, "value")) {
								attr.value = this.getDefaultAttributeValue(attr);
							}
							rattributes.push(attr);
					}
				}
			}
			next = false;
		}
		if(!next) this.parser.errorAt(position, "Tag was not closed.");
		parser.index++;

		if(dattributes.namespace) currentNamespace = dattributes.namespace;
		else if(dattributes.xhtml) currentNamespace = this.runtime + ".NS_XHTML";
		else if(dattributes.svg) currentNamespace = this.runtime + ".NS_SVG";
		else if(dattributes.mathml) currentNamespace = this.runtime + ".NS_MATHML";
		else if(dattributes.xul) currentNamespace = this.runtime + ".NS_XUL";
		else if(dattributes.xbl) currentNamespace = this.runtime + ".NS_XBL";
		else if(!computed) {
			if(tagName == "svg") currentNamespace = this.runtime + ".NS_SVG";
			else if(tagName == "mathml") currentNamespace = this.runtime + ".NS_MATHML";
		}

		var options = noInheritance => {
			var level = ++this.level;
			var ret = {};
			if(rattributes.length) {
				ret.attrs = rattributes.map(attribute => attribute.spacer ||
					(`${attribute.beforeName || ""}[${mapAttributeType(attribute.type)}, ` +
					`${attribute.computed ? attribute.name : `"${attribute.name || ""}"`}${attribute.afterName || ""}, ` +
					(attribute.beforeValue || "") + attribute.value +
					(attribute.optional ? ", 1" : "") + "]")
				).join(",");
			}
			if(iattributes.length) {
				var s = this.stringifyAttribute;
				ret.iattrs = iattributes.map(attribute => {
					var prev = {};
					return `[${mapAttributeType(attribute.type)},${attribute.beforeName}${s(attribute.before)}, ${attribute.inner.map((attribute, i) => {
						var ret = attribute.beforeValue;
						if(i == 0) {
							if(attribute.spread) {
								ret += `${attribute.expr}.concat(`;
							} else {
								ret += `Array(${s(attribute)}`;
							}
						} else {
							if(attribute.spread) {
								ret += `).concat(${attribute.expr}).concat(`;
							} else {
								if(!prev.spread) ret += ", ";
								ret += s(attribute);
							}
						}
						prev = attribute;
						return ret + attribute.afterValue;
					}).join("")}), ${s(attribute.after)},${attribute.beforeValue || ""}${attribute.value}]`;
				});
			}
			if(sattributes.length) {
				ret.spread = sattributes.map(({space, type, expr}) => `${space}[${mapAttributeType(type)}, ${expr}]`).join(", ");
			}
			if(Object.prototype.hasOwnProperty.call(dattributes, "widget")) {
				ret.widget = dattributes.widget;
			}
			if(currentNamespace) {
				ret.namespace = currentNamespace;
			}
			Object.defineProperty(ret, "toString", {
				enumerable: false,
				value: function(){
					var str = [];
					var i = 0;
					["attrs", "iattrs", "spread"].forEach(type => {
						var value = ret[type];
						if(value) str[i] = "[" + value + "]";
						i++;
					});
					["widget", "namespace"].forEach(type => {
						if(Object.prototype.hasOwnProperty.call(ret, type)) str[i] = ret[type];
						i++;
					});
					return "[" + str.join(",") + "]";
				}
			});
			// check inheritance
			if(!noInheritance) {
				var inheritance = this.inherit.filter(info => info && ((!info.level || info.level.indexOf(level) != -1) && (!info.whitelist || info.whitelist.indexOf(tagName) != -1))).map(info => `${this.inheritance}[${info.index}]`);
				return inheritance.length ? this.feature("inherit") + "(" + ret + ", " + inheritance.join(", ") + ")" : ret;
			} else {
				return ret;
			}
		};

		if(dattributes.this) parent = "this";
		else if(dattributes.window) parent = "window";
		else if(dattributes.document) parent = `${this.runtime}.document(${this.source.getContext()})`;
		else if(dattributes.html) parent = `${this.runtime}.documentElement(${this.source.getContext()})`;
		else if(dattributes.root) parent = `${this.runtime}.root(${this.source.getContext()}, ${dattributes.composed || 0})`;
		else if(dattributes.head) parent = `${this.runtime}.head(${this.source.getContext()})`;
		else if(dattributes.body) parent = `${this.runtime}.body(${this.source.getContext()})`;
		else if(dattributes.parent) parent = dattributes.parent;

		if(parent == "\"\"" || dattributes.orphan) {
			// an empty string and null have the same behaviour but null is faster as it avoids the query selector controls when appending
			parent = undefined;
			append = false;
		}

		if(!computed) {
			if(tagName.charAt(0) == ":") {
				let name = tagName.substr(1);
				if(this.options.aliases && Object.prototype.hasOwnProperty.call(this.options.aliases, name)) {
					let alias = this.options.aliases[name];
					tagName = alias.tagName;
					if(Object.prototype.hasOwnProperty.call(alias, "parent")) parent = alias.parent;
					if(Object.prototype.hasOwnProperty.call(alias, "element")) element = alias.element;
					if(Object.prototype.hasOwnProperty.call(alias, "create")) create = alias.create;
					if(Object.prototype.hasOwnProperty.call(alias, "update")) update = alias.update;
					if(Object.prototype.hasOwnProperty.call(alias, "append")) append = alias.append;
					if(Object.prototype.hasOwnProperty.call(alias, "mode")) newMode = alias.mode;
				} else {
					switch(name) {
						case "mode":
							newMode = arg;
							break;
						case "window":
							element = "window";
							create = append = false;
							break;
						case "document":
							element = `${this.runtime}.document(${this.source.getContext()})`;
							create = append = false;
							break;
						case "html":
							element = `${this.runtime}.documentElement(${this.source.getContext()})`;
							create = append = false;
							break;
						case "root":
							element = `${this.runtime}.root(${this.source.getContext()}, ${dattributes.composed || 0})`;
							create = append = false;
							break;
						case "head":
						case "body":
							element = `${this.runtime}.${name}(${this.source.getContext()})`;
							create = append = false;
							break;
						case "element":
							create = append = false;
							break;
						case "this":
							element = "this";
							create = append = false;
							break;
						case "super":
							computed = true;
							tagName = "super.render" + (arg ? "$" + arg : "") + ".bind(this)";
							rattributes.unshift({
								type: "$",
								name: "",
								value: "arguments[0]"
							});
							break;
						case "fragment":
							this.warn("Tag `<:fragment />` is deprecated. Use `<#document-fragment />` instead.");
							computed = true;
							tagName = `${this.runtime}.widgets["document-fragment"]`;
							break;
						case "shadow":
							this.warn("Tag `<:shadow />` is deprecated. Use `<#shadow-root />` instead.");
							computed = true;
							tagName = `${this.runtime}.widgets["shadow-root"]`;
							break;
						case "use":
							element = arg;
							create = append = false;
							break;
						case "query-all":
							all = true;
						case "query":
							element = arg;
							query = true;
							create = append = false;
							break;
						case "clone":
							element = arg;
							clone = true;
							create = false;
							break;
						case "adopt-all":
							all = true;
						case "adopt":
							element = arg;
							create = false;
							break;
						case "slot": {
							let column = arg.indexOf(",");
							if(column == -1) {
								slotName = arg.trim();
								tagName = "";
							} else {
								slotName = arg.substr(column + 1).trim();
								tagName = arg.substring(0, column).trim();
							}
							create = append = false;
							break;
						}
						case "inherit": {
							let c = currentInheritance = {};
							if(dattributes.level || dattributes.depth) {
								if(!dattributes.level) c.level = [1];
								else if(dattributes.level instanceof Array) c.level = dattributes.level.map(function(a){ return parseInt(a); });
								else c.level = [parseInt(dattributes.level)];
								if(dattributes.depth) {
									let depth = parseInt(dattributes.depth);
									if(isNaN(depth)) this.parser.error("Depth is not a valid number.");
									let levels = [];
									for(let i=0; i<depth; i++) {
										c.level.forEach(function(level){
											levels.push(level + i);
										});
									}
									c.level = levels;
								}
								for(let i=0; i<c.level.length; i++) {
									c.level[i] += this.level;
								}
							}
							if(dattributes.whitelist) {
								c.whitelist = dattributes.whitelist instanceof Array ? dattributes.whitelist : [dattributes.whitelist];
								c.whitelist = c.whitelist.map(function(a){
									return JSON.parse(a);
								});
							}
							create = update = append = false;
							break;
						}
						case "scope":
						case "debug":
						case "bind":
						case "unbind":
							create = update = append = false;
							break;
						default:
							this.parser.error("No special meaning associated to `<:" + name + " />` tag.");
					}
				}
			} else if(tagName.charAt(0) == "#") {
				// default widget
				let name = tagName.substr(1);
				if(/^[a-zA-Z]+$/.test(name)) {
					tagName = `${this.runtime}.widgets.${name}`;
				} else {
					tagName = `${this.runtime}.widgets["${name}"]`;
				}
				computed = true;
			} else if(tagName) {
				if(Object.prototype.hasOwnProperty.call(this.tagNames, tagName)) this.tagNames[tagName]++;
				else this.tagNames[tagName] = 1;
			}
		}

		if(dattributes.mode) newMode = dattributes.mode.slice(1, -1); // remove quotes from string

		if(newMode) {
			// mode declared, search it and validate it
			let name = newMode; //TODO parse attributes
			newMode = modeNames[newMode];
			if(newMode === undefined) this.parser.error(`Unknown mode "${name}".`);
		} else {
			// search for an auto-opening mode
			for(let i=0; i<modeRegistry.length; i++) {
				let info = modeRegistry[i];
				if(info.parser.matchesTag && info.parser.matchesTag(tagName, this.currentMode.parser)) {
					newMode = i;
					break;
				}
			}
		}

		if(newMode !== undefined) {

			// every attribute is parsed as JSON, expect an empty string (default value) which is converter to true
			let attributes = {};
			for(let key in dattributes) {
				try {
					let value = JSON.parse(dattributes[key]);
					attributes[key] = value === "" ? true : value;
				} catch(e) {
					// invalid values are ignored
				}
			}
			this.startMode(newMode, attributes);

		}

		let inline = false;

		if(computed || tagName != ":mode") {

			if(!computed && tagName == ":debug" || dattributes["debug"]) {
				this.source.push("if(" + this.runtime + ".isDebug) {");
				currentClosing.unshift("}");
			}

			if(tagName == ":bind" || tagName == ":unbind") {

				let str = value => Array.isArray(value) ? value.join(", ") : (value || "");

				this.source.addSource(`${this.feature(tagName.substr(1))}(`);
				this.source.addContext();
				this.source.addSource(`, [${str(dattributes.to)}], [${str(dattributes["maybe-to"])}], `);
				if(this.options.es6) {
					this.source.addContext();
					this.source.push(" => {");
					currentClosing.unshift("})");
				} else {
					this.source.addSource("function(");
					this.source.addContext();
					this.source.addSource("){");
					currentClosing.unshift("}.bind(this))");
				}

			} else {

				if(dattributes.unique) {
					this.source.addSource(`${this.feature("unique")}(`);
					this.source.addContext();
					this.source.addSource(`, ${this.nextId()}, `);
					if(this.options.es6) {
						this.source.addSource("() => ");
						currentClosing.unshift(")");
					} else {
						this.source.addSource("function(){return ");
						currentClosing.unshift("}.bind(this))");
					}
				}

				let before = [], after = [];
				let beforeClosing = "";

				// select right element to use
				if(query) {
					// querying element(s)
					let data = [this.chainFeature("query"), element];
					if(parent) data.push(parent);
					before.push(data);
				} else if(clone) {
					// cloning an element
					let data = [this.chainFeature("clone"), element];
					if(Object.prototype.hasOwnProperty.call(dattributes, "deep")) data.push(+dattributes.deep);
					before.push(data);
				} else if(slotName) {
					// using a slot
					let data = [this.chainFeature("slot"), `"${slotName}"`];
					if(tagName) data.push(`"${tagName}"`);
					before.push(data);
					append = false;
				} else if(element) {
					// using specific element(s)
					before.push([this.chainFeature("use"), element]);
				}

				// create or update
				if(create) {
					// tagName must be called before options, so it is calculated before attributes
					let data = [this.chainFeature(optional ? "createIf" : "create"), 0, options()];
					if(computed/* || this.options.widgets && this.options.widgets.indexOf(tagName) != -1*/) {
						data[1] = tagName;
						if(tagNameString) data.push(JSON.stringify(tagNameString));
					} else {
						data[1] = `"${tagName}"`;
					}
					before.push(data);
				} else if(update) {
					if(dattributes.clear) {
						before.push([this.chainFeature("clear")]);
					}
					let optString = options().toString();
					if(optString.length > 2) {
						// only trigger update if needed
						before.push([this.chainFeature("update"), optString]);
					}
				}

				// assign references
				if(dattributes.ref) {
					before.push([this.chainFeature("ref"), ...[].concat(dattributes.ref).map(ref => this.options.es6 ? `${this.value} => ${ref}=${this.value}` : `function(${this.value}){${ref}=${this.value}}.bind(this)`)]);
				}

				// assign widget references
				if(dattributes["ref-widget"]) {
					before.push([this.chainFeature("refWidget"), ...[].concat(dattributes["ref-widget"]).map(ref => this.options.es6 ? `${this.value} => ${ref}=${this.value}` : `function(${this.value}){${ref}=${this.value}}.bind(this)`)]);
				}

				// apply forms
				if(forms.length) {
					after.push([this.chainFeature("forms"), forms.map(({info, value, type, ref}) => {
						let data = [info, value];
						if(this.options.es6) {
							data.push(`${this.value} => {${ref}=${this.value}}`);
						} else {
							data.push(`function(${this.value}){${ref}=${this.value}}.bind(this)`);
						}
						if(type) {
							data.push(`"${type}"`);
						}
						return `[${data.join(", ")}]`;
					}).join(", ")]);
				}

				// append
				let appendRef = dattributes.early ? before : after;
				if(append) {
					let feature = "append";
					if(parent) feature += "To";
					if(optional) feature += "If";
					let data = [this.chainFeature(feature)];
					if(parent) data.push(parent);
					appendRef.push(data);
				}

				let chainAfter = this.currentMode.parser.chainAfter();
				if(chainAfter) {
					after.push(chainAfter);
				}

				// new slots
				if(!Array.isArray(dattributes.slot)) dattributes.slot = dattributes.slot ? [dattributes.slot] : [];
				if(dattributes["slot-content"]) dattributes.slot.push(this.runtime + ".SL_CONTENT");
				if(dattributes["slot-container"]) dattributes.slot.push(this.runtime + ".SL_CONTAINER");
				if(dattributes["slot-input"]) dattributes.slot.push(this.runtime + ".SL_INPUT");
				if(dattributes.slot.length) {
					before.push([this.chainFeature("slots"), `[${dattributes.slot.map(a => a === true ? 0 : a).join(", ")}]`]);
				}

				if(next == "/") {
					this.parser.expect(">");
					inline = true;
				}

				// if nothing is used just make sure the right element is returned
				if(!before.length && !after.length) {
					before.push([this.chainFeature("nop")]);
				}

				var mapNext = a => `, [${a.join(", ")}]`;
				this.source.uses.chain = true;
				this.source.addSource(`${this.chain}${all ? ".all" : ""}(`);
				if(dattributes.context) {
					this.source.addSource(dattributes.context);
				} else {
					this.source.addContext();
				}
				this.source.addSource(before.map(mapNext).join(""));
				if(!inline) {
					// create body
					this.source.addSource(`, [${this.chainFeature("body")}, `);
					if(this.options.es6) {
						this.source.addContext();
						this.source.addSource(" => {");
						beforeClosing += "}";
					} else {
						this.source.addSource("function(");
						this.source.addContext();
						this.source.addSource("){");
						beforeClosing += "}.bind(this)";
					}
				}
				currentClosing.unshift((!inline ? "]" : "") + after.map(mapNext).join("") + skipped + ")");

				currentClosing.unshift(beforeClosing);

				if(!inline) {

					if(currentInheritance) {
						currentInheritance.index = this.inheritCount++;
						this.source.push(`${this.inheritance}.push(${options(true)});`);
					} else if(currentNamespace) {
						currentInheritance = {index: this.inheritCount++};
						this.source.push(`${this.inheritance}.push([,,,,${currentNamespace}]);`);
					}

				}

			}

		}

		currentClosing = currentClosing.join("");

		if(inline) {
			if(newMode !== undefined) {
				this.endMode();
			}
			this.source.push(currentClosing);
			this.addSemicolon();
			this.level--;
		} else {
			this.inherit.push(currentInheritance);
			this.closing.push(currentClosing);
			this.tags.push({
				tagName: originalTagName,
				position: position,
				mode: newMode !== undefined,
				sourceIndex: this.source.length
			});
			if(newMode !== undefined) {
				this.currentMode.parser.start();
			}
		}
	}
	this.parser.last = undefined;
};

/**
 * @since 0.107.0
 */
Transpiler.prototype.isSpreadAttribute = function(){
	if(this.parser.input.substr(this.parser.index, 3) == "...") {
		this.parser.index += 3;
		return true;
	} else {
		return false;
	}
};

/**
 * @since 0.60.0
 */
Transpiler.prototype.parseAttributeName = function(force){
	var attr = {
		computed: false,
		parts: []
	};
	var required = force;
	// eslint-disable-next-line no-constant-condition
	while(true) {
		let ret = {};
		if(ret.name = this.parser.readComputedExpr()) {
			attr.computed = ret.computed = true;
			if(ret.name.charAt(0) == "[" && ret.name.charAt(ret.name.length - 1) == "]") {
				ret.name = ret.name.slice(1, -1);
				ret.name = this.runtime + ".config.shortcut" + (ret.name.charAt(0) == "[" ? "" : ".") + ret.name;
			} else {
				ret.name = this.parseCode(ret.name).source;
			}
		} else if(!(ret.name = this.parser.readAttributeName(required))) {
			break;
		}
		attr.parts.push(ret);
		required = false;
	}
	return attr;
};

/**
 * @since 0.127.0
 */
Transpiler.prototype.getDefaultAttributeValue = function({type, negated}){
	switch(type) {
		case "":
			return "\"\"";
		case "@":
		case "$":
		case "~":
		case "$$":
			return !negated;
		case "+":
			return 0;
		case "&":
			if(negated) return "!1";
	}
	this.parser.error("Value for attribute is required.");
};

/**
 * @since 0.82.0
 */
Transpiler.prototype.compileAttributeParts = function(attr){
	if(attr.computed) {
		var names = [];
		attr.parts.forEach(part => {
			if(part.computed) names.push(`(${part.name})`);
			else names.push(JSON.stringify(part.name));
		});
		attr.name = `${this.feature("attr")}(${names.join(", ")})`;
	} else {
		attr.name = attr.parts.map(part => part.name).join("");
	}
};

/**
 * @since 0.84.0
 */
Transpiler.prototype.stringifyAttribute = function(attr){
	return attr.computed ? attr.name : "\"" + attr.name + "\"";
};

/**
 * @since 0.129.0
 */
Transpiler.prototype.makeObservable = function(expr, observables, maybeObservables){
	var ret = `${this.feature("coff")}(${this.options.es6 ? `() => ${expr}` : `function(){return ${expr}}.bind(this)`})`;
	if(observables.length) ret += `.d(${this.arguments}, ${this.context}, [${observables.join(", ")}])`;
	if(maybeObservables.length) ret += `.m(${this.arguments}, ${this.context}, [${maybeObservables.join(", ")}])`;
	return ret;
};

/**
 * @since 0.67.0
 */
Transpiler.prototype.feature = function(name){
	this.features[name] = true;
	return this.runtime + "." + name;
};

/**
 * @since 0.130.0
 */
Transpiler.prototype.chainFeature = function(name){
	this.features["chain." + name] = true;
	return this.chain + "." + name;
};

/**
 * @since 0.62.0
 */
Transpiler.prototype.nextVar = function(){
	return String.fromCharCode(0x561 + this.count++ % 39);
};

/**
 * @since 0.62.0
 */
Transpiler.prototype.warn = function(message, position){
	if(!position) position = this.parser.position;
	this.warnings.push({message, position});
};

/**
 * @since 0.50.0
 */
Transpiler.prototype.transpile = function(input){

	var start = now();
	
	this.parser = new Parser(input);
	this.source = new Generated(this);

	this.count = hash((this.options.namespace || this.options.filename) + "") % 100000;
	
	this.runtime = this.nextVar();
	this.chain = this.nextVar();
	this.context0 = this.nextVar();
	this.context1 = this.nextVar();
	this.arguments = this.nextVar();
	this.inheritance = this.nextVar();
	this.value = this.nextVar();
	this.className = this.nextVar();
	this.unit = this.nextVar();

	this.tagNames = {};
	var features = this.features = {};

	this.warnings = [];
	
	this.tags = [];
	this.inherit = [];
	this.inheritCount = 0;
	this.closing = [];
	this.modes = [];

	this.level = 0;
	
	this.startMode(this.options.mode && modeNames[this.options.mode] || defaultMode, this.options.modeAttributes || {}).start();
	
	var open = Transpiler.prototype.open.bind(this);
	var close = Transpiler.prototype.close.bind(this);

	while(!this.parser.eof()) {
		this.updateTemplateLiteralParser();
		this.currentMode.parser.parse(open, close);
	}
	
	this.endMode();
	
	var v = Transpiler.VERSION || version && version.version;
	var umd = this.options.env.length > 1;
	var noenv = !umd && this.options.env[0] == "none";

	this.after = "";
	this.before = `/*! Transpiled${this.options.filename ? " from " + this.options.filename : ""} using Sactory v${v}. Do not edit manually. */`;
	if(noenv) {
		this.before += `var ${this.runtime}=${this.options.runtime || "Sactory"};`;
	} else {
		if(umd) this.before += "!function(a,b){";
		if(this.options.env.indexOf("amd") != -1) {
			if(umd) this.before += "if(typeof define=='function'&&define.amd){";
			this.before += `${this.options.amd && this.options.amd.anonymous ? "require" : "define"}(['${this.options.amd && this.options.amd.runtime || this.options.runtime || "sactory"}'${this.calcDeps("amd", ",'", "'")}],`;
			if(umd) this.before += "b)}else ";
		}
		if(this.options.env.indexOf("commonjs") != -1) {
			if(umd) {
				this.before += `if(typeof exports=='object'){module.exports=b(require('${this.options.commonjs && this.options.commonjs.runtime || this.options.runtime || "sactory"}')${this.calcDeps("commonjs", ",require('", "')")})}else `;
			} else {
				this.before += `var ${this.runtime}=require('${this.options.commonjs && this.options.commonjs.runtime || this.options.runtime || "sactory"}');`;
				noenv = true; // prevent addition of function call closing
			}
		}
		if(this.options.env.indexOf("none") != -1) {
			this.before += "{";
			if(this.options.globalExport) this.before += `a.${this.options.globalExport}=`;
			this.before += `b(${this.options.runtime || "Sactory"}${this.calcDeps("none", ",", "")})}`;
		} else if(umd) {
			// remove `else`
			this.before = this.before.slice(0, -5);
		}
		if(!noenv) {
			if(umd) this.before += "}(this,";
			this.before += "function(" + this.runtime;
			if(this.options.dependencies) this.before += "," + Object.keys(this.options.dependencies).join(",");
			this.before += "){";
		}
	}
	if(this.options.before) this.before += this.options.before;
	if(this.options.versionCheck) this.before += `${this.runtime}.check("${v}");`;
	if(this.source.uses.chain) this.before += `var ${this.chain}=${this.runtime}.chain;`;
	if(this.inheritCount) this.before += `var ${this.inheritance}=[];`;
	if(this.source.uses.context) {
		let data = [];
		if(this.options.scope) data.push(`element:${this.options.scope}`);
		if(this.options.anchor) data.push(`anchor:${this.options.anchor}`);
		if(this.options.bind) data.push(`bind:${this.options.bind}`);
		this.before += `var ${this.context0}={${data.join(",")}};`;
	}

	if(this.options.after) this.after += this.options.after;
	if(!noenv) this.after += "}.bind(this));";

	var source = this.source.toString();

	function addDependencies(feature) {
		if(Object.prototype.hasOwnProperty.call(dependencies, feature)) {
			dependencies[feature].forEach(function(f){
				features[f] = true;
				addDependencies(f);
			});
		}
	}

	Object.keys(features).forEach(addDependencies);

	if(!this.options.silent) {
		this.warnings.forEach(({message, position}) => console.warn(`${this.options.filename}[${position.line + 1}:${position.column}]: ${message}`));
	}
	
	return {
		time: now() - start,
		variables: {
			runtime: this.runtime,
			chain: this.chain,
			context0: this.context0,
			context1: this.context1,
			arguments: this.arguments,
			inheritance: this.inheritance
		},
		scope: this.options.scope,
		sequence: this.count,
		tags: this.tagNames,
		features: Object.keys(features).sort(),
		warnings: this.warnings,
		source: {
			before: this.before,
			after: this.after,
			all: this.before + source + this.after,
			contentOnly: source
		}
	};
	
};

Transpiler.prototype.calcDeps = function(moduleType, before, after){
	var ret = "";
	if(this.options.dependencies) {
		for(var key in this.options.dependencies) {
			var dep = this.options.dependencies[key];
			if(typeof dep == "string") {
				ret += before + dep + after;
			} else if(dep[moduleType]) {
				ret += before + dep[moduleType] + after;
			}
		}
	}
	return ret;
};

var dependencies = {
	// chain
	"chain.query": ["chain.use"],
	"chain.update": ["chain.updateImpl"],
	"chain.create": ["chain.updateImpl"],
	"chain.createIf": ["chain.update", "chain.create"],
	"chain.mixin": ["chain.appendTo", "chain.html"],
	"chain.append": ["chain.appendTo"],
	"chain.appendToIf": ["chain.appendTo"],
	"chain.appendIf": ["chain.append"],
	// bind
	"comment": ["anchor"],
	"bind": ["anchor"],
	"bindIfElse": ["anchor"],
	"bindEach": ["anchor"],
	"bindEachMaybe": ["bindEach", "forEachArray"],
	// style
	"convertStyle": ["compileStyle"],
	"cabs": ["convertStyle"],
};

module.exports = Transpiler;
	