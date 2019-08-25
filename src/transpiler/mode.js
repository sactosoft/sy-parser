var Polyfill = require("../polyfill");
var Parser = require("./parser");
var { uniq, stringify } = require("./util");

var modeRegistry = [];
var modeNames = {};
var defaultMode;

/**
 * @since 0.15.0
 */
function defineMode(names, parser, isDefault) {
	var id = modeRegistry.length;
	modeRegistry.push({
		name: names[0],
		parser: parser
	});
	names.forEach(function(name){
		modeNames[name] = id;
	});
	if(isDefault) defaultMode = id;
	return id;
}

/**
 * @since 0.53.0
 */
function getModeByName(name) {
	return modeNames[name];
}

/**
 * @since 0.35.0
 */
function startMode(mode, transpiler, parser, source, attributes, parent) {
	var m = modeRegistry[mode];
	var ret = new m.parser(transpiler, parser, source, attributes || {}, parent);
	ret.options = parser.options = m.parser.getOptions();
	return ret;
}

/**
 * @class
 * @since 0.15.0
 */
function Mode(transpiler, parser, source, attributes) {
	this.transpiler = transpiler;
	this.parser = parser;
	this.source = source;
	this.runtime = transpiler.runtime;
	this.context = transpiler.context;
	this.attributes = attributes;
}

Mode.prototype.add = function(text){
	this.source.push(text);
};

/**
 * @since 0.69.0
 */
Mode.prototype.parseCode = function(fun){
	this.parser.parseTemplateLiteral = null;
	var expr = Parser.prototype[fun].apply(this.parser, Array.prototype.slice.call(arguments, 1));
	this.transpiler.updateTemplateLiteralParser();
	return this.transpiler.parseCode(expr, this.parser);
};

Mode.prototype.parseCodeToSource = function(fun){
	var expr = Parser.prototype[fun].apply(this.parser, Array.prototype.slice.call(arguments, 1));
	return this.transpiler.parseCode(expr, this.parser).source;
};

Mode.prototype.parseCodeToValue = function(fun){
	return this.parseCode.apply(this, arguments).toValue();
};

Mode.prototype.start = function(){};

Mode.prototype.end = function(){};

Mode.prototype.afterappend = function(){};

Mode.prototype.beforeremove = function(){};

Mode.prototype.parse = function(handle, eof){};

/**
 * @class
 * @since 0.29.0
 */
function BreakpointMode(transpiler, parser, source, attributes, breakpoints) {
	Mode.call(this, transpiler, parser, source, attributes);
	this.breakpoints = ['<'].concat(breakpoints);
}

BreakpointMode.prototype = Object.create(Mode.prototype);

BreakpointMode.prototype.next = function(match){};

BreakpointMode.prototype.parse = function(handle, eof){
	var result = this.parser.find(this.breakpoints, false, true);
	if(result.pre) this.add(result.pre);
	if(result.match == '<') {
		if(this.parser.couldStartRegExp() && this.parser.input.charAt(this.parser.index - 2) != '<') {
			handle();
		} else {
			// just a comparison or left shift
			this.add("<");
			this.parser.last = '<';
			this.parser.lastIndex = this.parser.index;
		}
	} else if(result.match) {
		this.next(result.match);
	} else {
		eof();
	}
};

/**
 * Basic parser that recognises text, expressions (both textual and mixin)
 * and new tags.
 * @class
 * @since 0.28.0
 */
function TextExprMode(transpiler, parser, source, attributes) {
	Mode.call(this, transpiler, parser, source, attributes);
	this.current = [];
	this.chain = [];
	this.chainable = true;
}

TextExprMode.prototype = Object.create(Mode.prototype);

/**
 * Adds text to the chain.
 */
TextExprMode.prototype.addText = function(expr){
	this.chain.push(["text", expr]);
};

/**
 * Adds whitespace to the chain.
 */
TextExprMode.prototype.addSpace = function(space){
	this.chain.push([, space]);
};

/**
 * Parses and adds the current text to the chain.
 */
TextExprMode.prototype.addCurrent = function(){
	if(this.attributes.trimmed && this.current.length == 1 && this.current[0].text && /^\s*$/.test(this.current[0].value)) {
		// just whitespace
		this.addSpace(this.current[0].value);
	} else {
		var expr = [];
		var observables = [];
		var maybeObservables = [];
		for(var i in this.current) {
			var curr = this.current[i];
			if(curr.text) {
				if(curr.value.length) expr.push(stringify(this.replaceText(curr.value)));
			} else {
				Array.prototype.push.apply(observables, curr.value.observables);
				Array.prototype.push.apply(maybeObservables, curr.value.maybeObservables);
				expr.push('(' + curr.value.source + ')'); 
			}
		}
		if(expr.length) {
			var joined = expr.join(" + ");
			if(observables.length || maybeObservables.length) {
				joined = this.transpiler.feature(maybeObservables.length ? "maybeComputedObservable" : "computedObservable") + "(this, " + this.context + ".bind, [" +
					uniq(observables).join(", ") + "], function(){return " + joined + "}" + (maybeObservables.length ? ", [" + maybeObservables.join(", ") + "]" : "") + ")";
			}
			this.addText(joined);
		}
	}
	this.current = [];
};

/**
 * Closes the current chain. Either because a new tag is being opened
 * or because or a non-chainable operation is being started.
 * @since 0.128.0
 */
TextExprMode.prototype.endChain = function(){
	this.addCurrent();
	// add compiled data to source
	var source = "";
	var empty = true;
	this.chain.forEach(data => {
		var type = data.shift();
		if(type) {
			// text or mixin
			empty = false;
			source += `, [${this.transpiler.feature(type)}, ${data.join("")}]`;
		} else {
			// whitespace
			source += data[0];
		}
	});
	if(!empty) {
		this.add(`${this.runtime}(this, ${this.transpiler.arguments}, ${this.context}${source});`);
	} else {
		this.add(source);
	}
	this.chain = [];
};

/**
 * Closes the current chain and indicates that the whole parses cannot be used
 * as a single chain no more.
 */
TextExprMode.prototype.endChainable = function(){
	this.endChain();
	this.chainable = false;
};

/**
 * @deprecated
 */
TextExprMode.prototype.addFinalCurrent = function(){
	this.endChain();
};

/**
 * Adds text to the current data.
 */
TextExprMode.prototype.pushText = function(value){
	var last = this.current[this.current.length - 1];
	if(last && last.text) last.value += value;
	else this.current.push({text: true, value: value});
};

/**
 * Adds a code expression to the current data.
 */
TextExprMode.prototype.pushExpr = function(value){
	this.current.push({text: false, value: value});
};

/**
 * Removes whitespaces from the end of the current data.
 * @returns The trimmed text.
 */
TextExprMode.prototype.trimEnd = function(){
	var ret = "";
	var end = this.current[this.current.length - 1];
	if(end.text) {
		var trimmed = Polyfill.trimEnd.call(end.value);
		ret = end.value.substr(trimmed.length);
		end.value = trimmed;
	}
	return ret;
};

TextExprMode.prototype.replaceText = function(text){
	return text;
};

TextExprMode.prototype.handle = function(){
	return true;
};

TextExprMode.prototype.parseImpl = function(pre, match, handle, eof){
	switch(match) {
		case '$':
		case '#':
			if(pre.slice(-1) == '\\') {
				this.current[this.current.length - 1].value = this.current[this.current.length - 1].value.slice(0, -1) + match;
				break;
			} else if(this.parser.peek() == '{') {
				var expr = this.parseCode("skipEnclosedContent", true);
				if(match == '#') {
					this.addCurrent();
					this.chain.push(["mixin", expr.source]);
				} else {
					this.pushExpr(expr);
				}
			} else {
				this.pushText(match);
			}
			break;
		case '<':
			if(this.handle()) {
				if(this.parser.peek() == "/") {
					// tag is being closed, chainable is not modified
					this.endChain();
				} else {
					// another tag is being opened, cannot chain
					this.endChainable();
				}
				handle();
			} else {
				this.pushText('<');
			}
			break;
		default:
			this.endChain();
			eof();
	}
};

TextExprMode.prototype.parse = function(handle, eof){
	var result = this.parser.find(['<', '$', '#'], false, true);
	this.pushText(result.pre);
	this.parseImpl(result.pre, result.match, handle, eof);
};

/**
 * @class
 * @since 0.53.0
 */
function LogicMode(transpiler, parser, source, attributes) {
	TextExprMode.call(this, transpiler, parser, source, attributes);
	this.count = 0;
	this.statements = [];
	this.popped = [];
}

LogicMode.prototype = Object.create(TextExprMode.prototype);

LogicMode.prototype.getLineText = function(){
	var last = this.current[this.current.length - 1];
	if(last.text) {
		var index = last.value.lastIndexOf('\n');
		if(index > 0) return last.value.substr(index);
		else return last.value;
	} else {
		return "";
	}
};

LogicMode.prototype.parseLogic = function(expected, type, closing){
	var line;
	if(
		this.parser.input.substr(this.parser.index, expected.length - 1) == expected.substr(1) && // when the expected keyword is found
		!/\S/.test(line = this.getLineText()) && // and when it is at the start of line
		!/[a-zA-Z0-9_$]/.test(this.parser.input.charAt(this.parser.index + expected.length - 1)) // and when it is an exact keyword
	) {
		this.parser.index += expected.length - 1;
		var trimmed = this.trimEnd();
		this.endChainable();
		this.add(trimmed);
		if(type === 0) {
			// variable
			this.endChainable(); // variable declaration cannot be chained
			var end = this.parser.find(closing || ['=', ';'], true, {comments: true, strings: false});
			this.add(expected + end.pre + end.match); // add declaration (e.g. `var a =` or `var a;`)
			if(end.match == '=') {
				this.add(this.transpiler.parseCode(this.parser.readExpression()).source); // add the value/body of the variable
				if(this.parser.readIf(';')) this.add(';');
			}
		} else {
			// statement
			var statement = Polyfill.startsWith.call(expected, "else") ? this.popped.pop() : {
				type: expected,
				startIndex: this.source.length,
				observables: [],
				maybeObservables: [],
				inlineable: true,
				end: "",
				parts: []
			};
			var part = {
				type: expected,
				observables: [],
				maybeObservables: [],
				declStart: this.source.length
			};
			statement.parts.push(part);
			if(type === 1) {
				// with condition (e.g. `statement(condition)`)
				var reparse = (source, parser) => {
					var parsed = this.transpiler.parseCode(source, parser);
					Array.prototype.push.apply(statement.observables, parsed.observables);
					Array.prototype.push.apply(statement.maybeObservables, parsed.maybeObservables);
					Array.prototype.push.apply(part.observables, parsed.observables);
					Array.prototype.push.apply(part.maybeObservables, parsed.maybeObservables);
					return parsed.source;
				};
				var skipped = this.parser.skipImpl({});
				if(this.parser.peek() != '(') this.parser.error("Expected '(' after '" + expected + "'.");
				var position = this.parser.position;
				var source = reparse(this.parser.skipEnclosedContent(), this.parser);
				if(expected == "foreach") {
					var parser = new Parser(source.slice(1, -1), position);
					parser.options = {comments: true, strings: true, regexp: true};
					skipped += parser.skipImpl({comments: true, strings: false});
					var expr, from, to;
					// `from` and `to` need to be reparsed searching for observables as `from` and `to`
					// are only keywords in this specific context
					if(Polyfill.startsWith.call(parser.input.substr(parser.index), "from ")) {
						parser.index += 5;
						from = reparse(parser.readExpression());
						parser.expectSequence("to ");
						to = reparse(parser.readExpression());
					} else if(Polyfill.startsWith.call(parser.input.substr(parser.index), "to ")) {
						parser.index += 3;
						from = "0";
						to = reparse(parser.readExpression());
					} else {
						expr = parser.readExpression();
					}
					var rest = "";
					if(parser.input.substr(parser.index, 3) == "as ") {
						parser.index += 3;
						rest = parser.input.substr(parser.index);
					}
					if(expr) {
						// divided in 4 parts so it can be modified later
						this.add(this.transpiler.feature("forEach") + "(this, ")
						this.add(expr);
						this.add(", function(");
						this.add(rest + ")");
					} else {
						statement.type = part.type = "range";
						this.add(`${this.transpiler.feature("range")}(this, ${from}, ${to}, function(${rest})`);
					}
					statement.inlineable = false;
					statement.end = ");";
				} else {
					this.add(expected + skipped + source);
				}
			} else {
				// without condition
				this.add(expected);
			}
			this.add(this.parser.skipImpl({}));
			if(!(statement.inline = part.inline = !this.parser.readIf('{')) || !statement.inlineable) this.add('{');
			part.declEnd = this.source.length;
			this.statements.push(statement);
			this.onStatementStart(statement);
		}
		return true;
	} else {
		if(line && line.slice(-1) == '\\') {
			var curr = this.current[this.current.length - 1];
			curr.value = curr.value.slice(0, -1);
		}
		return false;
	}
};

LogicMode.prototype.find = function(){
	return this.parser.find(['$', '#', '<', 'c', 'l', 'v', 'b', 'd', 'i', 'e', 'f', 'w', 's', '}', '\n'], false, false);
};

LogicMode.prototype.parse = function(handle, eof){
	var result = this.find();
	this.pushText(result.pre);
	switch(result.match) {
		case 'c':
			if(!this.parseLogic("const", 0) && !this.parseLogic("case", 0, [':'])) this.pushText('c');
			break;
		case 'l':
			if(!this.parseLogic("let", 0)) this.pushText('l');
			break;
		case 'v':
			if(!this.parseLogic("var", 0)) this.pushText('v');
			break;
		case 'b':
			if(!this.parseLogic("break", 0)) this.pushText('b');
			break;
		case 'd':
			if(!this.parseLogic("default", 0, [':'])) this.pushText('d');
			break;
		case 'i':
			if(!this.parseLogic("if", 1)) this.pushText('i');
			break;
		case 'e':
			if(!this.parseLogic("else if", 1) && !this.parseLogic("else", 2)) this.pushText('e');
			break;
		case 'f':
			if(!this.parseLogic("foreach", 1) && !this.parseLogic("for", 1)) this.pushText('f');
			break;
		case 'w':
			if(!this.parseLogic("while", 1)) this.pushText('w');
			break;
		case 's':
			if(!this.parseLogic("switch", 1)) this.pushText('s');
			break;
		case '}':
			if(result.pre.slice(-1) == '\\') {
				var curr = this.current[this.current.length - 1];
				curr.value = curr.value.slice(0, -1) + '}';
			} else if(this.statements.length) {
				var trimmed = this.trimEnd();
				this.endChainable();
				this.add(trimmed);
				this.add('}');
				var statement = this.statements.pop();
				statement.endIndex = this.source.length;
				statement.parts[statement.parts.length - 1].close = this.source.length - 1;
				this.popped.push(statement);
				this.onStatementEnd(statement);
			} else {
				this.pushText('}');
			}
			break;
		case '\n':
			if(this.statements.length && this.statements[this.statements.length - 1].inline) {
				var trimmed = this.trimEnd();
				this.endChainable();
				this.add(trimmed);
				this.add('\n');
				var statement = this.statements.pop();
				if(!statement.inlineable) this.source[this.source.length - 1] += '}';
				statement.endIndex = this.source.length;
				statement.parts[statement.parts.length - 1].close = this.source.length - 1;
				this.popped.push(statement);
				this.onStatementEnd(statement);
			} else {
				this.pushText('\n');
			}
			break;
		default:
			this.parseImpl(result.pre, result.match, handle, eof);
	}
};

LogicMode.prototype.onStatementStart = function(statement){};

LogicMode.prototype.onStatementEnd = function(statement){};

LogicMode.prototype.end = function(){
	for(var i=0; i<this.popped.length; i++) {
		var popped = this.popped[i];
		var bind = !!popped.observables.length || !!popped.maybeObservables.length;
		if(bind) {
			if(popped.type == "if") {
				// calculate conditions and remove them from source
				var conditions = [];
				var replacement = `, function(${this.context})`;
				popped.parts.forEach(function(part){
					var source = this.source[part.declStart].substr(part.type.length);
					if(part.type == "else") {
						conditions.push("[]");
					} else {
						var condition = this.transpiler.options.es6 ? `() => ${source}` : `function(){return ${source}}`;
						conditions.push(`[${condition}, [${uniq(part.observables)}]${part.maybeObservables.length ? `, [${uniq(part.maybeObservables)}]` : ""}]`);
					}
					this.source[part.declStart] = replacement;
					if(part.inline) {
						this.source[part.declStart] += "{";
						this.source[part.close] += "}";
					}
				}.bind(this));
				this.source[popped.startIndex] = `${this.transpiler.feature("bindIfElse")}(this, ${this.transpiler.arguments}, ${this.context}, [${conditions.join(", ")}]` + this.source[popped.startIndex];
				this.source[popped.endIndex] = ");" + this.source[popped.endIndex];
			} else if(popped.type == "foreach") {
				// the source is divided in 4 parts
				var expr = this.source[popped.startIndex + 1];
				var getter = this.transpiler.options.es6 ? `() => ${expr}` : `function(){return ${expr}}`;
				var maybe = !!popped.maybeObservables.length;
				this.source[popped.startIndex] = "";
				this.source[popped.startIndex + 1] = "";
				this.source[popped.startIndex + 2] = `${this.transpiler.feature("bindEach" + (maybe ? "Maybe" : ""))}(this, ${this.transpiler.arguments}, ${this.context}, ${(maybe ? popped.maybeObservables : popped.observables)[0]}, ${getter}, function(${this.context}, `;
				// no need to close as the end is the same as the Sactory.forEach function call
			} else {
				// normal bind
				this.source[popped.startIndex] = this.transpiler.feature("bind") + "(this, " + this.context +
					", [" + uniq(popped.observables).join(", ") + "]" + (popped.maybeObservables.length ? ".concat(" + this.transpiler.feature("filterObservables") + "([" + uniq(popped.maybeObservables) + "]))" : "") +
					", function(" + this.context + "){" + this.source[popped.startIndex];
				this.source[popped.endIndex] = "});" + this.source[popped.endIndex];
			}
		}
		if(popped.end.length) {
			// prepend end if needed
			this.source[popped.endIndex] = popped.end + this.source[popped.endIndex];
		}
	}
};

/**
 * @class
 * @since 0.99.0
 */
function OptionalLogicMode(transpiler, parser, source, attributes) {
	LogicMode.call(this, transpiler, parser, source, attributes);
	if(!attributes.logic) {
		this.parse = TextExprMode.prototype.parse.bind(this);
	}
}

OptionalLogicMode.prototype = Object.create(LogicMode.prototype);

/**
 * @class
 * @since 0.15.0
 */
function SourceCodeMode(transpiler, parser, source, attributes) {
	BreakpointMode.call(this, transpiler, parser, source, attributes, ['(', ')', '@', '*', '^', '=', '{']);
	this.observables = [];
	this.maybeObservables = [];
	this.parentheses = [];
}

SourceCodeMode.getOptions = function(){
	return {isDefault: true, code: true, regexp: true};
};

SourceCodeMode.prototype = Object.create(BreakpointMode.prototype);

SourceCodeMode.prototype.restoreIndex = function(char){
	this.add(this.parser.last = char);
	this.parser.lastIndex = this.parser.index - 1;
};

SourceCodeMode.prototype.handleParenthesis = function(match){
	this.restoreIndex(match);
};

SourceCodeMode.prototype.addObservable = function(observables, maybeObservables, name){
	if(name.length) {
		var source = this.source[this.source.length - 1];
		this.source[this.source.length - 1] = source.substring(0, source.length - name.length);
	}
	var maybe = !!this.parser.readIf('?');
	var skipped = this.parser.skip();
	if(skipped) this.add(skipped);
	if(this.parser.peek() == '(') {
		name += this.parseCodeToSource("skipEnclosedContent");
	} else {
		name += this.parseCodeToSource("readVarName", true);
	}
	if(maybe) {
		this.add(this.transpiler.feature("value") + "(" + name + ")");
		if(maybeObservables) maybeObservables.push(name);
	} else {
		this.add(name + ".value");
		if(observables) observables.push(name);
	}
	this.parser.last = ')';
	this.parser.lastIndex = this.parser.index;
};

SourceCodeMode.prototype.lookBehind = function(){
	var end = this.parser.lastIndex;
	var index = end;
	while(index >= 0 && /[\s\.a-zA-Z0-9_$]/.test(this.parser.input.charAt(index))) {
		index--;
	}
	return this.parser.input.substring(index + 1, end + 1);
};

SourceCodeMode.prototype.next = function(match){
	function getName() {
		var skipped = this.parser.skip();
		if(skipped) this.add(skipped);
		if(this.parser.peek() == '(') {
			return this.parseCodeToSource("skipEnclosedContent");
		} else {
			return this.parseCodeToSource("readVarName", true);
		}
	}
	switch(match) {
		case '(':
			this.parentheses.push(false);
			this.parser.parentheses.push(this.parser.lastIndex);
			this.handleParenthesis(match);
			break;
		case ')':
			var popped = this.parentheses.pop();
			if(popped) this.add(popped);
			this.parser.lastParenthesis = this.parser.parentheses.pop();
			this.handleParenthesis(match);
			break;
		case '@':
			if(this.parser.readIf('@')) {
				this.add(this.runtime);
			} else {
				var skip = this.parser.skipImpl({strings: false});
				var peek = this.parser.peek();
				var fallback = function(){
					if(peek === undefined || !/[a-zA-Z0-9_]/.test(peek)) {
						this.add(this.context);
						if(skip) this.add(skip);
					} else {
						this.add('@' + skip);
					}
				}.bind(this);
				var match = this.parser.input.substr(this.parser.index).match(/^(?:((?:\.?[a-zA-Z0-9_$]+)*)(\s*)\()/);
				if(match) {
					var add = (fun, args) => {
						this.parser.index += match[0].length;
						this.add(skip + fun + match[2] + "(" + (args || ""));
						this.parentheses.push(false);
					};
					switch(match[1]) {
						case "subscribe":
							add(this.transpiler.feature("subscribe"), this.context + ", ");
							break;
						case "rollback":
							add(this.transpiler.feature("rollback"), this.context + ", ");
							break;
						case "watch":
						case "watch.deep":
						case "watch.deps":
						case "watch.always":
							// new observable
							var type = match[1].substr(5);
							this.parser.index += match[0].length;
							this.parser.parseTemplateLiteral = null;
							var parsed = this.transpiler.parseCode(this.parser.readExpression());
							this.transpiler.updateTemplateLiteralParser();
							if(parsed.observables && parsed.observables.length || parsed.maybeObservables && parsed.maybeObservables.length || type == ".deps") {
								// computed
								this.add(this.transpiler.feature("computedObservable") + type + "(this, " + this.context + ".bind, " + parsed.toSpreadValue());
							} else {
								this.add(this.transpiler.feature("observable") + type + "(" + parsed.source);
							}
							this.parentheses.push(false);
							break;
						case "text":
						case "html":
							this.parser.index += match[0].length - 1;
							this.add(this.transpiler.feature(match[1]) + "(" + this.context + ", " + this.parseCodeToValue("skipEnclosedContent") + ")");
							break;
						case "on":
							add(this.transpiler.feature("on"), "this, " + this.context + ", ");
							break;
						case "slot":
							add(this.context + ".registry.add", this.transpiler.feature("anchor") + "(" + this.context + "), ");
							break;
						case "animations.add":
							add(this.transpiler.feature("addAnimation"));
							break;
						case "ready":
						case "quote":
							add(this.transpiler.feature(match[1]));
							break;
						case "rgb":
						case "rgba":
						case "hsl":
						case "hsla":
						case "darken":
						case "lighten":
						case "saturate":
						case "desaturate":
						case "grayscale":
						case "greyscale":
						case "invert":
						case "pastel":
						case "sepia":
						case "mix":
						case "contrast":
							add(this.transpiler.feature("css." + match[1]));
							break;
						default:
							fallback();
					}
				} else {
					fallback();
				}
			}
			break;
		case '*':
			if(this.parser.couldStartRegExp()) {
				if(this.parser.readIf('*')) {
					// new observable
					var position = this.parser.position;
					this.parser.parseTemplateLiteral = null;
					var parsed = this.transpiler.parseCode(this.parser.readSingleExpression(true));
					this.transpiler.updateTemplateLiteralParser();
					if(parsed.observables && parsed.observables.length || parsed.maybeObservables && parsed.maybeObservables.length) {
						// should be computed
						this.transpiler.warn("The observable syntax `**` cannot be used to create computed observables, use `@watch` instead.", position);
					}
					this.add(this.transpiler.feature("observable") + "(" + parsed.source + ")");
					this.parser.last = ')';
					this.parser.lastIndex = this.parser.index;
				} else {
					// get/set observable
					this.addObservable(this.observables, this.maybeObservables, "");
				}
			} else if(this.parser.last == '.') {
				this.addObservable(this.observables, this.maybeObservables, this.lookBehind());
			} else {
				// just a multiplication or exponentiation
				this.restoreIndex('*');
				if(this.parser.peek() == '*') this.restoreIndex(this.parser.read()); // exponentiation, skip to avoid trying to treat it as observable
			}
			break;
		case '^':
			if(this.parser.couldStartRegExp()) {
				this.addObservable(null, null, "");
			} else if(this.parser.last == '.') {
				this.addObservable(null, null, this.lookBehind());
			} else {
				// xor operator
				this.restoreIndex('^');
			}
			break;
		case '=':
			if(!this.attributes.inAttr && this.parser.peek() == ">") {
				// arrow function, inject arguments
				// find the source and index where the last non-whitespace character is located
				var find = sub => {
					var left = this.parser.index - this.parser.lastIndex - sub;
					var index = this.transpiler.source.length;
					var source;
					do {
						source = this.transpiler.source[--index];
						left -= source.length;
					} while(left >= 0);
					return { source, index, left };
				};
				var inject = (data, {source, index, left}) => this.transpiler.source[index] = source.slice(0, -left) + data + source.substr(-left);
				if(this.parser.last == ')') {
					// can inject using the current arguments
					// recover pointer through the source
					//TODO keep going back if spaces are found
					//TODO do not inject when there is already a rest parameter
					var info = find(1);
					var char = info.source.charAt(-info.left - 1);
					inject((char != '(' && char != ',' ? ", " : "") + "..." + this.transpiler.arguments, info);
				} else {
					// wrap single argument (one keyword)
					// inject after the keyword
					var info = find(2);
					inject(`, ...${this.transpiler.arguments})`, info);
					// add open parenthesis
					var index = info.index;
					var source = this.transpiler.source[index]; // getting it again as it may be changed
					var left = info.left + 1;
					while(/[a-zA-Z0-9_$]/.test(source.charAt(-left))) {
						if(++left > 0) {
							source = this.transpiler.source[--index];
							left = -source.length + 1;
						}
					}
					left--;
					inject("(", { source, index, left });
				}
			}
			this.restoreIndex('=');
			break;
		case '{':
			var fun = this.parser.last == ')';
			this.restoreIndex('{');
			if(!this.attributes.inAttr && fun && !this.parser.lastKeywordAtIn(this.parser.lastParenthesis, "if", "else", "for", "while", "do", "switch", "catch")) {
				// new function declaration, inject arguments declaration
				this.add(`var ${this.transpiler.arguments}=arguments;`);
			}
			break;
	}
};

/**
 * @class
 * @since 0.108.0
 */
function AutoSourceCodeMode(transpiler, parser, source, attributes) {
	SourceCodeMode.call(this, transpiler, parser, source, attributes);
}

AutoSourceCodeMode.getOptions = SourceCodeMode.getOptions;

AutoSourceCodeMode.prototype = Object.create(SourceCodeMode.prototype);

/**
 * @class
 * @since 0.15.0
 */
function HTMLMode(transpiler, parser, source, attributes) {
	OptionalLogicMode.call(this, transpiler, parser, source, attributes);
}

HTMLMode.getOptions = function(){
	return {comments: false, strings: false};
};

HTMLMode.prototype = Object.create(OptionalLogicMode.prototype);

HTMLMode.prototype.replaceText = Text.replaceEntities || (function(){
	var converter;
	return function(data){
		if(!converter) converter = document.createElement("textarea");
		converter.innerHTML = data;
		return converter.value;
	}
})();

/**
 * @class
 * @since 0.108.0
 */
function AutoHTMLMode(transpiler, parser, source, attributes, parent) {
	HTMLMode.call(this, transpiler, parser, source, parent && parent.attributes || attributes);
}

AutoHTMLMode.getOptions = HTMLMode.getOptions;

AutoHTMLMode.matchesTag = function(tagName, currentMode){
	return currentMode instanceof AutoSourceCodeMode && tagName != ":debug" && tagName != ":bind";
};

AutoHTMLMode.prototype = Object.create(HTMLMode.prototype);

/**
 * @class
 * @since 0.37.0
 */
function ScriptMode(transpiler, parser, source, attributes) {
	TextExprMode.call(this, transpiler, parser, source, attributes);
}

ScriptMode.getOptions = function(){
	return {comments: false, strings: false, children: false, tags: ["script"]};
};

ScriptMode.prototype = Object.create(TextExprMode.prototype);

ScriptMode.prototype.handle = function(){
	return !!/^\/#?script>/.exec(this.parser.input.substr(this.parser.index));
};

/**
 * @class
 * @since 0.15.0
 */
function CSSMode(transpiler, parser, source, attributes) {
	OptionalLogicMode.call(this, transpiler, parser, source, attributes);
}

CSSMode.getOptions = function(){
	return {comments: true, inlineComments: false, strings: true, children: false};
};

CSSMode.prototype = Object.create(OptionalLogicMode.prototype);

/**
 * @class
 * @since 0.99.0
 */
function SSBMode(transpiler, parser, source, attributes) {
	LogicMode.call(this, transpiler, parser, source, attributes);
	this.observables = [];
	this.maybeObservables = [];
	this.expr = [];
	this.scopes = [transpiler.nextVarName()];
	this.scope = attributes.scope;
	this.scoped = !!attributes.scoped;
	this.inExpr = false;
}

SSBMode.getOptions = function(){
	return {strings: true, children: false};
};

SSBMode.matchesTag = function(tagName){
	return tagName.toLowerCase() == "style";
};

SSBMode.prototype = Object.create(LogicMode.prototype);

SSBMode.prototype.addScope = function(selector){
	var scope = this.transpiler.nextVarName();
	this.add("var " + scope + "=" + this.transpiler.feature("select") + "(" + this.scopes[this.scopes.length - 1] + ", " + selector + ");");
	this.scopes.push(scope);
};

SSBMode.prototype.removeScope = function(){
	this.scopes.pop();
};

SSBMode.prototype.skip = function(){
	var skipped = this.parser.skip();
	if(skipped) this.add(skipped);
};

SSBMode.prototype.start = function(){
	this.add(`${this.transpiler.feature("compileAndBindStyle")}(${this.context}, ${this.transpiler.options.es6 ? "() => " : "function()"}{`);
	this.add(`var ${this.scopes[0]}=${this.transpiler.feature("root")}();`);
	if(this.scoped) this.addScope(`'.' + ${this.runtime}.config.prefix + ${this.context}.element.__builder.runtimeId`);
	else if(this.scope) this.addScope(JSON.stringify('.' + this.scope));
};

SSBMode.prototype.find = function(){
	return this.parser.find(['$', '<', 'v', 'c', 'l', 'i', 'e', 'f', 'w', '{', '}', ';'], false, false);
};

SSBMode.prototype.lastValue = function(callback, parser){
	var end;
	if(this.current.length) {
		if(this.current[0].text) {
			// trim start
			var value = this.current[0].value;
			var trimmed = Polyfill.trimStart.call(value);
			this.add(value.substring(0, value.length - trimmed.length));
			this.current[0].value = trimmed;
		}
		if(this.current[this.current.length - 1].text) {
			// trim end
			var value = this.current[this.current.length - 1].value;
			var trimmed = Polyfill.trimEnd.call(value);
			end = value.substr(trimmed.length);
			this.current[this.current.length - 1].value = trimmed;
		}
	}
	callback.call(this, this.current.filter(function(part){
		return !part.text || part.value.length;
	}).map(function(part){
		if(part.text) {
			return stringify(part.value);
		} else {
			Array.prototype.push.apply(this.observables, part.value.observables);
			Array.prototype.push.apply(this.maybeObservables, part.value.maybeObservables);
			return parser ? parser(part.value.source) : '(' + part.value.source + ')';
		}
	}.bind(this)).join(" + "));
	if(end) this.add(end);
	this.current = [];
};

SSBMode.prototype.parseImpl = function(pre, match, handle, eof){
	switch(match) {
		case '{':
			this.lastValue(function(value){
				this.addScope(value);
			});
			this.statements.push({
				selector: true,
				observables: [],
				maybeObservables: [],
				end: "",
				parts: [{}]
			});
			this.inExpr = false;
			break;
		case ';':
			var scope = this.scopes[this.scopes.length - 1];
			var value;
			for(var i=0; i<this.current.length; i++) {
				var current = this.current[i];
				if(current.text) {
					var column = current.value.indexOf(':');
					if(column != -1) {
						var transpiler = this.transpiler;
						var value = this.current.slice(i + 1);
						value.unshift({text: true, value: current.value.substr(column + 1)});
						current.value = current.value.substring(0, column);
						this.current = this.current.slice(0, i + 1);
						this.lastValue(function(value){
							this.add(scope + ".value(" + value);
						});
						this.add(",");
						this.current = value;
						this.lastValue(function(value){
							this.add(value + ");");
						}, function(value){
							return SSBMode.createExpr(value, transpiler);
						});
						break;
					}
				}
			}
			if(!value) {
				this.lastValue(function(value){
					this.add(scope + ".stat(" + value + ");");
				});
			}
			this.inExpr = false;
			break;
		default:
			TextExprMode.prototype.parseImpl.call(this, pre, match, handle, eof);
	}
};

SSBMode.prototype.parse = function(handle, eof){
	if(!this.inExpr) {
		this.add(this.parser.skip());
		this.inExpr = true;
	}
	LogicMode.prototype.parse.call(this, handle, eof);
};

SSBMode.prototype.onStatementStart = function(statement){
	this.inExpr = false;
};

SSBMode.prototype.onStatementEnd = function(statement){
	if(statement.selector) {
		this.removeScope();
	} else {
		Array.prototype.push.apply(this.observables, statement.observables);
		Array.prototype.push.apply(this.maybeObservables, statement.maybeObservables);
	}
	this.inExpr = false;
};

SSBMode.prototype.addFinalCurrent = function(){
	// add remaining spaces at end
	while(this.current.length) {
		this.add(this.current.shift().value);
	}
};

SSBMode.prototype.end = function(){
	// replace unneeded closing braces and add statement.end needed for foreach
	this.popped.forEach(popped => {
		if(popped.selector) {
			this.source[popped.endIndex - 1] = "";
		} else if(popped.end.length) {
			this.source[popped.endIndex] = popped.end + this.source[popped.endIndex];
		}
	});
	// add return statement
	this.add(`return ${this.scopes[0]}.content}, [${uniq(this.observables).join(", ")}], [${this.maybeObservables.join(", ")}])`);
};

SSBMode.prototype.actionImpl = function(type){
	if(this.scoped) return `function(){this.parentNode.__builder.${type}Class(${this.runtime}.config.prefix + this.__builder.runtimeId)}`;
};

SSBMode.prototype.afterappend = function(){
	return this.actionImpl("add");
};

SSBMode.prototype.beforeremove = function(){
	return this.actionImpl("remove");
};

SSBMode.createExprImpl = function(expr, info, transpiler){
	var parser = new Parser(expr);
	parser.options = {comments: true, strings: true};
	function skip() {
		var skipped = parser.skipImpl({strings: false, comments: true});
		if(skipped) info.computed += skipped;
	}
	function readSign() {
		var result = parser.readImpl(/^[+-]{1,2}/, false);
		if(result) {
			info.computed += result;
			info.op++;
		}
	}
	function readOp() {
		var result = parser.readImpl(/^[+*\/%-]/, false);
		if(result) {
			info.computed += result;
			info.op++;
			return true;
		}
	}
	while(!parser.eof()) {
		skip();
		readSign();
		if(parser.peek() == '(') {
			info.computed += '(';
			var start = parser.index + 1;
			if(!SSBMode.createExprImpl(parser.skipEnclosedContent().slice(1, -1), info, transpiler)) return false;
			info.computed += ')';
		} else {
			var v = parser.readSingleExpression(true);
			if(/^[a-zA-Z_$]/.exec(v)) {
				// it's a variable
				info.is = true;
				info.computed += transpiler.feature("unit") + "(" + info.param + "," + v + ")";
			} else {
				info.computed += v;
			}
		}
		readSign();
		skip();
		var op = readOp();
		skip();
		if(!op && !parser.eof()) return false;
	}
	return true;
};

SSBMode.createExpr = function(expr, transpiler){
	var param = transpiler.nextVarName();
	var info = {
		runtime: transpiler.runtime,
		param: param,
		computed: "(function(" + param + "){return " + transpiler.feature("computeUnit") + "(" + param + ",",
		is: false,
		op: 0
	};
	return SSBMode.createExprImpl(expr, info, transpiler) && info.is && info.op && (info.computed + ")})({})") || ("(" + expr + ")");
};

/**
 * @class
 * @since 0.124.0
 */
function HTMLCommentMode(transpiler, parser, source, attributes) {
	TextExprMode.call(this, transpiler, parser, source, attributes);
	this.values = [];
}

HTMLCommentMode.getOptions = function(){
	return {comments: false, strings: false, children: false};
};

HTMLCommentMode.prototype = Object.create(TextExprMode.prototype);

HTMLCommentMode.prototype.add = function(text){
	if(text.length) this.values.push(stringify(text));
};

HTMLCommentMode.prototype.addText = function(expr){
	this.values.push(expr);
};

HTMLCommentMode.prototype.parse = function(handle, eof){
	var result = this.parser.find(['$'], false, true);
	this.pushText(result.pre);
	this.parseImpl(result.pre, result.match, handle, eof);
};

// register default modes

defineMode(["code", "javascript", "js"], SourceCodeMode, true);
defineMode(["html"], HTMLMode);
defineMode(["script"], ScriptMode);
defineMode(["css"], CSSMode);
defineMode(["ssb", "style"], SSBMode);
defineMode(["__comment"], HTMLCommentMode); // anonymous define

// register auto modes after default modes to give less precedence to `matchesTag`

defineMode(["auto-code"], AutoSourceCodeMode);
defineMode(["auto-html"], AutoHTMLMode);

module.exports = { modeRegistry, modeNames, defaultMode, startMode };