// init global variables
require("./dom");

var Polyfill = require("./polyfill");
var Parser = require("./parser");

var version = require("../version");

var Const = require("./const");

var performance = require("perf_hooks").performance;

function hash(str) {
	var hash = 0;
	for(var i=0; i<str.length; i++) {
		hash += str.charCodeAt(i) * 16777619;
	}
	return hash;
}

function uniq(array) {
	return array.filter(function(value, i){
		return array.indexOf(value) == i;
	});
}

function stringify(str) {
	// that's not very fast
	return '"' + str.replace(/(\r?\n)|([\\"])/gm, function(_, newline, escaped){
		if(newline) return "\\n\\\n";
		else return '\\' + escaped;
	}) + '"';
}

function now() {
	return performance.now ? performance.now() : new Date().getTime();
}

function mapAttributeType(type) {
	switch(type) {
		case "": return Const.BUILDER_TYPE_NONE;
		case "@": return Const.BUILDER_TYPE_PROP;
		case "&": return Const.BUILDER_TYPE_STYLE;
		case "~": return Const.BUILDER_TYPE_CONCAT;
		case "+": return Const.BUILDER_TYPE_ON;
		case "$": return Const.BUILDER_TYPE_WIDGET;
		case "$$": return Const.BUILDER_TYPE_EXTEND_WIDGET;
	}
}

function mapAttributeTypeName(type) {
	switch(type) {
		case "": return "attribute";
		case "@": return "property";
		case "&": return "style";
		case "~": return "concat";
		case "+": return "event";
		case "$": return "widget";
		case "$$": return "extend widget";
	}
}

var modeRegistry = [];
var modeNames = {};
var defaultMode;

/**
 * @since 0.15.0
 */
Transpiler.defineMode = function(names, parser, isDefault){
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
};

/**
 * @since 0.53.0
 */
Transpiler.getModeByName = function(name){
	return modeNames[name];
};

/**
 * @since 0.53.0
 */
Transpiler.replaceMode = function(mode, parser){
	modeRegistry[mode].parser = parser;
};

/**
 * @since 0.35.0
 */
Transpiler.startMode = function(mode, transpiler, parser, source, attributes, parent){
	var m = modeRegistry[mode];
	var ret = new m.parser(transpiler, parser, source, attributes || {}, parent);
	ret.options = parser.options = m.parser.getOptions();
	return ret;
};

/**
 * @class
 * @since 0.15.0
 */
function SourceParser(transpiler, parser, source, attributes) {
	this.transpiler = transpiler;
	this.parser = parser;
	this.source = source;
	this.runtime = transpiler.runtime;
	this.context = transpiler.context;
	this.attributes = attributes;
}

SourceParser.prototype.add = function(text){
	this.source.push(text);
};

/**
 * @since 0.69.0
 */
SourceParser.prototype.parseCode = function(fun){
	this.parser.parseTemplateLiteral = null;
	var expr = Parser.prototype[fun].apply(this.parser, Array.prototype.slice.call(arguments, 1));
	this.transpiler.updateTemplateLiteralParser();
	return this.transpiler.parseCode(expr, this.parser);
};

SourceParser.prototype.parseCodeToSource = function(fun){
	var expr = Parser.prototype[fun].apply(this.parser, Array.prototype.slice.call(arguments, 1));
	return this.transpiler.parseCode(expr, this.parser).source;
};

SourceParser.prototype.parseCodeToValue = function(fun){
	return this.parseCode.apply(this, arguments).toValue();
};

SourceParser.prototype.start = function(){};

SourceParser.prototype.end = function(){};

SourceParser.prototype.afterappend = function(){};

SourceParser.prototype.beforeremove = function(){};

SourceParser.prototype.parse = function(handle, eof){};

/**
 * @class
 * @since 0.29.0
 */
function BreakpointParser(transpiler, parser, source, attributes, breakpoints) {
	SourceParser.call(this, transpiler, parser, source, attributes);
	this.breakpoints = ['<'].concat(breakpoints);
}

BreakpointParser.prototype = Object.create(SourceParser.prototype);

BreakpointParser.prototype.next = function(match){};

BreakpointParser.prototype.parse = function(handle, eof){
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
 * @class
 * @since 0.28.0
 */
function TextParser(transpiler, parser, source, attributes) {
	SourceParser.call(this, transpiler, parser, source, attributes);
	this.current = [];
}

TextParser.prototype = Object.create(SourceParser.prototype);

TextParser.prototype.addText = function(expr){
	this.add(this.transpiler.feature("text") + "(" + this.context + ", " + expr + ");");
};

TextParser.prototype.addCurrent = function(){
	if(this.attributes.trimmed && this.current.length == 1 && this.current[0].text && /^\s*$/.test(this.current[0].value)) {
		// just whitespace
		this.add(this.current[0].value);
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

TextParser.prototype.addFinalCurrent = function(){
	this.addCurrent();
};

TextParser.prototype.pushText = function(value){
	var last = this.current[this.current.length - 1];
	if(last && last.text) last.value += value;
	else this.current.push({text: true, value: value});
};

TextParser.prototype.pushExpr = function(value){
	this.current.push({text: false, value: value});
};

TextParser.prototype.trimEnd = function(){
	var ret = "";
	var end = this.current[this.current.length - 1];
	if(end.text) {
		var trimmed = Polyfill.trimEnd.call(end.value);
		ret = end.value.substr(trimmed.length);
		end.value = trimmed;
	}
	return ret;
};

TextParser.prototype.replaceText = function(text){
	return text;
};

TextParser.prototype.handle = function(){
	return true;
};

TextParser.prototype.parseImpl = function(pre, match, handle, eof){
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
					this.add(this.transpiler.feature("mixin") + "(" + this.context + ", " + expr.source + ");");
				} else {
					this.pushExpr(expr);
				}
			} else {
				this.pushText(match);
			}
			break;
		case '<':
			if(this.handle()) {
				this.addFinalCurrent();
				handle();
			} else {
				this.pushText('<');
			}
			break;
		default:
			this.addFinalCurrent();
			eof();
	}
};

TextParser.prototype.parse = function(handle, eof){
	var result = this.parser.find(['<', '$', '#'], false, true);
	this.pushText(result.pre);
	this.parseImpl(result.pre, result.match, handle, eof);
};

/**
 * @class
 * @since 0.53.0
 */
function LogicParser(transpiler, parser, source, attributes) {
	TextParser.call(this, transpiler, parser, source, attributes);
	this.count = 0;
	this.statements = [];
	this.popped = [];
}

LogicParser.prototype = Object.create(TextParser.prototype);

LogicParser.prototype.getLineText = function(){
	var last = this.current[this.current.length - 1];
	if(last.text) {
		var index = last.value.lastIndexOf('\n');
		if(index > 0) return last.value.substr(index);
		else return last.value;
	} else {
		return "";
	}
};

LogicParser.prototype.parseLogic = function(expected, type, closing){
	var line;
	if(
		this.parser.input.substr(this.parser.index, expected.length - 1) == expected.substr(1) && // when the expected keyword is found
		!/\S/.test(line = this.getLineText()) && // and when it is at the start of line
		!/[a-zA-Z0-9_$]/.test(this.parser.input.charAt(this.parser.index + expected.length - 1)) // and when it is an exact keyword
	) {
		this.parser.index += expected.length - 1;
		var trimmed = this.trimEnd();
		this.addCurrent();
		this.add(trimmed);
		if(type === 0) {
			// variable
			var end = this.parser.find(closing || ['=', ';'], true, {comments: true, strings: false});
			this.add(expected + end.pre + end.match);
			if(end.match == '=') {
				this.add(this.transpiler.parseCode(this.parser.readExpression()).source);
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
				var transpiler = this.transpiler;
				function reparse(source, parser) {
					var parsed = transpiler.parseCode(source, parser);
					Array.prototype.push.apply(statement.observables, parsed.observables);
					Array.prototype.push.apply(statement.maybeObservables, parsed.maybeObservables);
					Array.prototype.push.apply(part.observables, parsed.observables);
					Array.prototype.push.apply(part.maybeObservables, parsed.maybeObservables);
					return parsed.source;
				}
				// with condition
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
						this.add(this.transpiler.feature("forEach") + "(this, ")
						this.add(expr);
						this.add(", function(");
						this.add(rest + ")");
					} else {
						statement.type = part.type = "range";
						this.add(this.transpiler.feature("range") + "(this, " + from + ", " + to + ", function(" + rest + ")");
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

LogicParser.prototype.find = function(){
	return this.parser.find(['$', '#', '<', 'c', 'l', 'v', 'b', 'd', 'i', 'e', 'f', 'w', 's', '}', '\n'], false, false);
};

LogicParser.prototype.parse = function(handle, eof){
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
				this.addCurrent();
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
				this.addCurrent();
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

LogicParser.prototype.onStatementStart = function(statement){};

LogicParser.prototype.onStatementEnd = function(statement){};

LogicParser.prototype.end = function(){
	for(var i=0; i<this.popped.length; i++) {
		var popped = this.popped[i];
		var bind = !!popped.observables.length || !!popped.maybeObservables.length;
		if(bind) {
			if(popped.type == "if") {
				// calculate conditions and remove them from source
				var conditions = [];
				var replacement = ", function(" + this.context + ")";
				popped.parts.forEach(function(part){
					var source = this.source[part.declStart].substr(part.type.length);
					if(part.type == "else") {
						conditions.push("[]");
					} else {
						conditions.push("[function(){return " + source + "}, [" + uniq(part.observables) + "]" +
							(part.maybeObservables.length ? ", [" + uniq(part.maybeObservables) + "]" : "") + "]");
					}
					this.source[part.declStart] = replacement;
					if(part.inline) {
						this.source[part.declStart] += "{";
						this.source[part.close] += "}";
					}
				}.bind(this));
				this.source[popped.startIndex] = this.transpiler.feature("bindIfElse") + "(this, " + this.context +
					", [" + conditions.join(", ") + "]" + this.source[popped.startIndex];
				this.source[popped.endIndex] = ");" + this.source[popped.endIndex];
			} else if(popped.type == "foreach") {
				// the source is divided in 4 parts
				var expr = this.source[popped.startIndex + 1];
				this.source[popped.startIndex] = "";
				this.source[popped.startIndex + 1] = "";
				this.source[popped.startIndex + 2] = this.transpiler.feature("bindEach" + (popped.maybeObservables.length ? "Maybe" : "")) +
					"(this, " + this.context + ", " + (popped.maybeObservables.length ? popped.maybeObservables[0] : popped.observables[0]) +
					", function(){return " + expr + "}, function(" + this.context + ", ";
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
function OptionalLogicParser(transpiler, parser, source, attributes) {
	LogicParser.call(this, transpiler, parser, source, attributes);
	if(!attributes.logic) {
		this.parse = TextParser.prototype.parse.bind(this);
	}
}

OptionalLogicParser.prototype = Object.create(LogicParser.prototype);

/**
 * @class
 * @since 0.15.0
 */
function JavascriptParser(transpiler, parser, source, attributes) {
	BreakpointParser.call(this, transpiler, parser, source, attributes, ['(', ')', '@', '*', '^']);
	this.observables = [];
	this.maybeObservables = [];
	this.parentheses = [];
}

JavascriptParser.getOptions = function(){
	return {isDefault: true, code: true, regexp: true};
};

JavascriptParser.prototype = Object.create(BreakpointParser.prototype);

JavascriptParser.prototype.handleParenthesis = function(match){
	this.add(this.parser.last = match);
	this.parser.lastIndex = this.parser.index;
};

JavascriptParser.prototype.addObservable = function(observables, maybeObservables, name){
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

JavascriptParser.prototype.lookBehind = function(){
	var end = this.parser.lastIndex;
	var index = end;
	while(index >= 0 && /[\s\.a-zA-Z0-9_$]/.test(this.parser.input.charAt(index))) {
		index--;
	}
	return this.parser.input.substring(index + 1, end + 1);
};

JavascriptParser.prototype.next = function(match){
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
						case "roolback":
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
				this.add('*');
				if(this.parser.peek() == '*') this.add(this.parser.read()); // exponentiation, skip to avoid trying to trat it as observable
				this.parser.last = '*';
			}
			break;
		case '^':
			if(this.parser.couldStartRegExp()) {
				this.addObservable(null, null, "");
			} else if(this.parser.last == '.') {
				this.addObservable(null, null, this.lookBehind());
			} else {
				// xor operator
				this.add('^');
				this.parser.last = '^';
			}
			break;
	}
};

/**
 * @class
 * @since 0.108.0
 */
function AutoJavascriptParser(transpiler, parser, source, attributes) {
	JavascriptParser.call(this, transpiler, parser, source, attributes);
}

AutoJavascriptParser.getOptions = JavascriptParser.getOptions;

AutoJavascriptParser.prototype = Object.create(JavascriptParser.prototype);

/**
 * @class
 * @since 0.15.0
 */
function HTMLParser(transpiler, parser, source, attributes) {
	OptionalLogicParser.call(this, transpiler, parser, source, attributes);
}

HTMLParser.getOptions = function(){
	return {comments: false, strings: false};
};

HTMLParser.prototype = Object.create(OptionalLogicParser.prototype);

HTMLParser.prototype.replaceText = Text.replaceEntities || (function(){
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
function AutoHTMLParser(transpiler, parser, source, attributes, parent) {
	HTMLParser.call(this, transpiler, parser, source, parent && parent.attributes || attributes);
}

AutoHTMLParser.getOptions = HTMLParser.getOptions;

AutoHTMLParser.matchesTag = function(tagName, currentMode){
	return currentMode instanceof AutoJavascriptParser && tagName != ":debug" && tagName != ":bind";
};

AutoHTMLParser.prototype = Object.create(HTMLParser.prototype);

/**
 * @class
 * @since 0.37.0
 */
function ScriptParser(transpiler, parser, source, attributes) {
	TextParser.call(this, transpiler, parser, source, attributes);
}

ScriptParser.getOptions = function(){
	return {comments: false, strings: false, children: false, tags: ["script"]};
};

ScriptParser.prototype = Object.create(TextParser.prototype);

ScriptParser.prototype.handle = function(){
	return !!/^\/#?script>/.exec(this.parser.input.substr(this.parser.index));
};

/**
 * @class
 * @since 0.15.0
 */
function CSSParser(transpiler, parser, source, attributes) {
	OptionalLogicParser.call(this, transpiler, parser, source, attributes);
}

CSSParser.getOptions = function(){
	return {comments: true, inlineComments: false, strings: true, children: false};
};

CSSParser.prototype = Object.create(OptionalLogicParser.prototype);

/**
 * @class
 * @since 0.99.0
 */
function SSBParser(transpiler, parser, source, attributes) {
	LogicParser.call(this, transpiler, parser, source, attributes);
	this.observables = [];
	this.maybeObservables = [];
	this.expr = [];
	this.scopes = [transpiler.nextVarName()];
	this.scope = attributes.scope;
	this.scoped = !!attributes.scoped;
	this.inExpr = false;
}

SSBParser.getOptions = function(){
	return {strings: true, children: false};
};

SSBParser.matchesTag = function(tagName){
	return tagName.toLowerCase() == "style";
};

SSBParser.prototype = Object.create(LogicParser.prototype);

SSBParser.prototype.addScope = function(selector){
	var scope = this.transpiler.nextVarName();
	this.add("var " + scope + "=" + this.transpiler.feature("select") + "(" + this.scopes[this.scopes.length - 1] + ", " + selector + ");");
	this.scopes.push(scope);
};

SSBParser.prototype.removeScope = function(){
	this.scopes.pop();
};

SSBParser.prototype.skip = function(){
	var skipped = this.parser.skip();
	if(skipped) this.add(skipped);
};

SSBParser.prototype.start = function(){
	this.add(`${this.transpiler.feature("compileAndBindStyle")}(${this.context}, function(){`);
	this.add(`var ${this.scopes[0]}=${this.transpiler.feature("root")}();`);
	if(this.scoped) this.addScope(`'.' + ${this.runtime}.config.prefix + ${this.context}.element.__builder.runtimeId`);
	else if(this.scope) this.addScope(JSON.stringify('.' + this.scope));
};

SSBParser.prototype.find = function(){
	return this.parser.find(['$', '<', 'v', 'c', 'l', 'i', 'e', 'f', 'w', '{', '}', ';'], false, false);
};

SSBParser.prototype.lastValue = function(callback, parser){
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

SSBParser.prototype.parseImpl = function(pre, match, handle, eof){
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
							return SSBParser.createExpr(value, transpiler);
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
			TextParser.prototype.parseImpl.call(this, pre, match, handle, eof);
	}
};

SSBParser.prototype.parse = function(handle, eof){
	if(!this.inExpr) {
		this.add(this.parser.skip());
		this.inExpr = true;
	}
	LogicParser.prototype.parse.call(this, handle, eof);
};

SSBParser.prototype.onStatementStart = function(statement){
	this.inExpr = false;
};

SSBParser.prototype.onStatementEnd = function(statement){
	if(statement.selector) {
		this.removeScope();
	} else {
		Array.prototype.push.apply(this.observables, statement.observables);
		Array.prototype.push.apply(this.maybeObservables, statement.maybeObservables);
	}
	this.inExpr = false;
};

SSBParser.prototype.addFinalCurrent = function(){
	// add remaining spaces at end
	while(this.current.length) {
		this.add(this.current.shift().value);
	}
};

SSBParser.prototype.end = function(){
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

SSBParser.prototype.actionImpl = function(type){
	if(this.scoped) return `function(){this.parentNode.__builder.${type}Class(${this.runtime}.config.prefix + this.__builder.runtimeId)}`;
};

SSBParser.prototype.afterappend = function(){
	return this.actionImpl("add");
};

SSBParser.prototype.beforeremove = function(){
	return this.actionImpl("remove");
};

SSBParser.createExprImpl = function(expr, info, transpiler){
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
			if(!SSBParser.createExprImpl(parser.skipEnclosedContent().slice(1, -1), info, transpiler)) return false;
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

SSBParser.createExpr = function(expr, transpiler){
	var param = transpiler.nextVarName();
	var info = {
		runtime: transpiler.runtime,
		param: param,
		computed: "(function(" + param + "){return " + transpiler.feature("computeUnit") + "(" + param + ",",
		is: false,
		op: 0
	};
	return SSBParser.createExprImpl(expr, info, transpiler) && info.is && info.op && (info.computed + ")})({})") || ("(" + expr + ")");
};

/**
 * @class
 * @since 0.124.0
 */
function CommentParser(transpiler, parser, source, attributes) {
	TextParser.call(this, transpiler, parser, source, attributes);
	this.values = [];
}

CommentParser.getOptions = function(){
	return {comments: false, strings: false, children: false};
};

CommentParser.prototype = Object.create(TextParser.prototype);

CommentParser.prototype.add = function(text){
	this.values.push(stringify(text));
};

CommentParser.prototype.addText = function(expr){
	this.values.push(expr);
};

CommentParser.prototype.parse = function(handle, eof){
	var result = this.parser.find(['$'], false, true);
	this.pushText(result.pre);
	this.parseImpl(result.pre, result.match, handle, eof);
};

// export parsers

Transpiler.Internal = {
	Parser,
	SourceParser,
	BreakpointParser,
	TextParser,
	LogicParser,
	JavascriptParser,
	AutoJavascriptParser,
	HTMLParser,
	AutoHTMLParser,
	ScriptParser,
	CSSParser,
	SSBParser
};

// register default modes

Transpiler.defineMode(["code", "javascript", "js"], JavascriptParser, true);
Transpiler.defineMode(["html"], HTMLParser);
Transpiler.defineMode(["script"], ScriptParser);
Transpiler.defineMode(["css"], CSSParser);
Transpiler.defineMode(["ssb", "style"], SSBParser);
Transpiler.defineMode(["__comment"], CommentParser);

// register auto modes after default modes to give less precedence to `matchesTag`

Transpiler.defineMode(["auto-code"], AutoJavascriptParser);
Transpiler.defineMode(["auto-html"], AutoHTMLParser);

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
		this.options.env.forEach(function(env){
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
	var currentParser = Transpiler.startMode(mode, this, this.parser, this.source, attributes, this.currentMode && this.currentMode.parser);
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
	var source = [];
	var mode = Transpiler.startMode(modeId, this, parser, source);
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
		mode.parse(function(){ source.push('<'); }, function(){});
	}
	mode.end();
	return {mode, source};
};

/**
 * @since 0.42.0
 */
Transpiler.prototype.parseCode = function(input, parentParser){
	var {mode, source} = this.parseImpl(defaultMode, input, parentParser);
	source = source.join("");
	var observables = mode.observables ? uniq(mode.observables) : [];
	var maybeObservables = mode.maybeObservables ? uniq(mode.maybeObservables) : [];
	var ret = {
		source, observables, maybeObservables,
		toValue: () => observables.length || maybeObservables.length ? `${this.feature(maybeObservables.length ? "maybeComputedObservable" : "computedObservable")}(this, ${this.context}.bind, ${ret.toSpreadValue()})` : source,
		toSpreadValue: () => `[${observables.join(", ")}], function(){return ${source}}, [${maybeObservables.join(", ")}]`
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
 * @since 0.46.0
 */
Transpiler.prototype.wrapFunction = function(value, ret){
	if(value.charAt(0) == '{' && value.charAt(value.length - 1) == '}') {
		return "function(" + Array.prototype.slice.call(arguments, 2).join(", ") + "){" + (ret ? "return " : "") + value.substring(1, value.length - 1) + "}";
	} else {
		return value;
	}
};
	
/**
 * Inserts a semicolon after a tag creation if needed.
 * @since 0.22.0
 */
Transpiler.prototype.addSemicolon = function(){
	if(this.currentMode.options.code) {
		var skip = this.parser.skip();
		var peek = this.parser.peek();
		if(peek != ';' && peek != ':' && peek != ',' && peek != '.' && peek != ')' && peek != ']' && peek != '}' && peek != '&' && peek != '|') this.source.push(";");
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
	var closeCode = !this.parser.eof();
	if(tagName !== undefined) {
		// closing a tag, not called as EOF
		var closeInfo = this.tags.pop();
		if(closeInfo.tagName && closeInfo.tagName != tagName) {
			this.warn("Tag `" + closeInfo.tagName + "` is not closed properly (used `</" + tagName + ">` instead of `</" + closeInfo.tagName + ">`).", closeInfo.position);
		}
		if(closeInfo.mode) this.endMode();
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
	if(this.parser.peek() == '/') {
		this.parser.index++;
		var result = this.parser.find(['>'], true, false); // skip until closed
		this.close(result.pre);
	} else if(this.parser.peek() == '!') {
		this.parser.index++;
		var rest = this.parser.input.substr(this.parser.index);
		if(Polyfill.startsWith.call(rest, "COMMENT ")) {
			this.warn("The `<!COMMENT ...>` tag is deprecated. Use `<!// ...` or `<!/* ... */>` instead.");
			this.parser.index += 8;
			this.source.push("/*" + this.parser.findSequence(">", true).slice(0, -1) + "*/");
		} else {
			var next = this.parser.input.substr(this.parser.index, 2);
			if(next == "--") {
				// xml comment
				this.parser.index += 2;
				this.source.push(this.feature("comment") + "(" + this.context + ", " + this.parseText(this.parser.findSequence("-->", true).slice(0, -3)) + ")");
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
	} else if(this.currentMode.options.children === false && this.parser.peek() != '#') {
		throw new Error("Mode " + this.currentMode.name + " cannot have children");
	} else {
		var position = this.parser.position;
		var parser = this.parser;
		var skipped = "", requiredSkip;
		function skip(required) {
			return skipped = parser.skipImpl({comments: true, strings: false}); // before/after attributes
			//skipped += s;
			var ret = skipped;
			skipped = s;
			return ret;
			//if(required) requiredSkip = s;
		}
		var currentIndex = this.source.length;

		var create = true; // whether a new element is being created
		var update = true; // whether the element is being updated, only considered if create is false
		var append = true; // whether the element should be appended to the current element after its creation
		var unique = false; // whether the new element should be appended always or only when its not already on the DOM
		var parent = this.context + ".element"; // element that the new element will be appended to, if not null
		var updatedElement; // element that will be updated when optional
		var element = this.context + ".element"; // element that will be updated
		var queryElement;
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
		var createAnchor;
		var transitions = [];
		var visibility;
		var forms = [];
		var computed = false;
		var optional = false;
		var selector, originalTagName, tagName = "";
		var selectorAll = false;
		var slotName;
		this.updateTemplateLiteralParser();
		if(selector = this.parser.readQueryExpr()) {
			this.warn("Query tag names are deprecated. Use the `<:query />` and `<:query-all />` tags instead.`");
			selector = this.parseCode(selector).source;
			selectorAll = !!this.parser.readIf('+');
			if(this.parser.readIf('*')) {
				queryElement = "document";
				if(!selectorAll) selectorAll = !!this.parser.readIf('+');
			}
			create = append = false;
		} else {
			optional = !!this.parser.readIf('?');
			if(tagName = this.parser.readComputedExpr()) {
				tagName = this.parseCode(tagName).source;
				computed = true;
			} else {
				originalTagName = tagName = this.parser.readTagName(true);
			}
		}
		skip(true);
		if(this.parser.peek() == "(") {
			arg = this.parser.skipEnclosedContent(true);
			skip(true);
		}
		var next = false;
		while(!this.parser.eof() && (next = this.parser.peek()) != '>' && next != '/') {
			if(!/[\n\t ]/.test(skipped)) this.parser.error("Space is required between attribute names.");
			this.updateTemplateLiteralParser();
			var attr = {
				optional: !!this.parser.readIf('?'),
				negated: !!this.parser.readIf('!'),
				type: this.parser.readAttributePrefix() || "",
				beforeName: skipped,
				afterName: "",
				beforeValue: ""
			};
			if(this.isSpreadAttribute()) {
				//TODO assert not optional nor negated
				sattributes.push({type: attr.type, expr: this.parser.readSingleExpression(false, true), space: skipped});
				skip(true);
			} else {
				var content = this.parseAttributeName(false);
				if(this.parser.readIf('{')) {
					if(attr.type == ':' || attr.type == '*' || attr.type == '#') this.parser.error("Cannot interpolate this type of attribute.");
					attr.before = content;
					attr.inner = [];
					do {
						skip(); //TODO do not ignore
						if(this.isSpreadAttribute()) {
							attr.inner.push({spread: true, expr: this.parser.readSingleExpression(false, true)});
						} else {
							var an = this.parseAttributeName(true);
							this.compileAttributeParts(an);
							attr.inner.push(an);
						}
						skip(); //TODO do not ignore
					} while((next = this.parser.read()) == ',');
					if(next != '}') this.parser.error("Expected '}' after interpolated attributes list.");
					attr.after = this.parseAttributeName(false);
					this.compileAttributeParts(attr.before);
					this.compileAttributeParts(attr.after);
				} else if(content.parts.length == 0 && attr.type != '$') {
					this.parser.error("Cannot find a valid attribute name.");
				} else {
					Polyfill.assign(attr, content);
				}
				// read value
				skip();
				if(this.parser.peek() == '=') {
					attr.afterName = skipped;
					this.parser.index++;
					attr.beforeValue = skip();
					this.parser.parseTemplateLiteral = null;
					attr.value = this.parser.readAttributeValue();
					if(attr.type == '+') {
						attr.value = this.wrapFunction(attr.value, false, "event");
					}
					var parsed = this.parseCode(attr.value);
					attr.value = attr.type != '+' ? parsed.toValue() : parsed.source;
					attr.sourceValue = parsed.source;
					skip(true);
				}
				if(attr.inner) {
					if(!attr.hasOwnProperty("value")) {
						attr.value = this.getDefaultAttributeValue(attr);
					}
					iattributes.push(attr);
				} else {
					this.compileAttributeParts(attr);
					switch(attr.type) {
						case '#':
							if(attr.computed) this.parser.error("Mode attributes cannot be computed.");
							newMode = modeNames[attr.name];
							break;
						case ':':
							if(attr.computed) this.parser.error("Compile-time attributes cannot be computed.");
							if(!attr.hasOwnProperty("value")) attr.value = !attr.negated;
							if(Object.prototype.hasOwnProperty.call(dattributes, attr.name)) {
								if(dattributes[attr.name] instanceof Array) {
									dattributes[attr.name].push(attr.value);
								} else {
									var a = dattributes[attr.name] = [dattributes[attr.name], attr.value];
									a.toString = function(){
										return '[' + this.join(", ") + ']';
									};
								}
							} else {
								dattributes[attr.name] = attr.value;
							}
							break;
						case '*':
							var add = false;
							var temp;
							var start = attr.parts[0];
							if(!start || start.computed) this.parser.error("First part of semi compile-time attributes cannot be computed.");
							var column = start.name.indexOf(":");
							if(column == -1) column = start.name.length;
							var name = start.name.substring(0, column);
							switch(name) {
								case "next":
									temp = true;
								case "prev":
									attr.type = "";
									if(start.name.length == 5) attr.parts.shift();
									else start.name = start.name.substr(5);
									var value = temp ? `${this.feature("nextId")}(${this.context})` : `${this.feature("prevId")}()`;
									if(attr.hasOwnProperty("value")) attr.value += " + " + value;
									else attr.value = value;
									add = true;
									break;
								/*case "io":
								case "in":
								case "out":
									var type = start.name.substring(0, column);
									start.name = start.name.substr(column + 1);
									if(!start.name.length) attr.parts.shift();
									this.compileAttributeParts(attr);
									transitions.push({type: type, name: this.stringifyAttribute(attr), value: attr.value})
									break;*/
								case "show":
									var value = attr.hasOwnProperty("value") ? attr.value : 1;
									visibility = `[${value}, ${attr.negated ^ 1}]`;
									break;
								case "hide":
									var value = attr.hasOwnProperty("value") ? attr.value : 0;
									visibility = `[${value}, ${+attr.negated}]`;
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
									rattributes.push({type: "", name: "type", value: '"' + name + '"'});
								case "form":
								case "value":
									if(!attr.hasOwnProperty("value")) this.parser.error("Value for form attribute is required.");
									if(column == start.name.length - 1) attr.parts.shift();
									else start.name = start.name.substr(column);
									this.compileAttributeParts(attr);
									forms.push([this.stringifyAttribute(attr), attr.value, attr.sourceValue || attr.value]);
									break;
								default:
									this.parser.error("Unknown semi compile-time attribute '" + name + "'.");
							}
							if(add) this.compileAttributeParts(attr);
							else break;
						default:
							if(!attr.hasOwnProperty("value")) {
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
				ret.attrs = rattributes.map(function(attribute){
					return (attribute.beforeName || "") + "[" + mapAttributeType(attribute.type) + ", " +
						(attribute.computed ? attribute.name : '"' + (attribute.name || "") + '"') + (attribute.afterName || "") + ", " +
						(attribute.beforeValue || "") + attribute.value +
						(attribute.optional ? ", 1" : "") + "]";
				}).join(",");
			}
			if(iattributes.length) {
				var s = this.stringifyAttribute;
				ret.iattrs = iattributes.map(function(attribute){
					var prev = {};
					return "[" + mapAttributeType(attribute.type) + ", " + s(attribute.before) + ", " + attribute.inner.map(function(attribute, i){
						var ret = "";
						if(i == 0) {
							if(attribute.spread) {
								ret = attribute.expr + ".concat(";
							} else {
								ret = "Array(" + s(attribute);
							}
						} else {
							if(attribute.spread) {
								ret = ").concat(" + attribute.expr + ").concat(";
							} else {
								if(!prev.spread) ret = ", ";
								ret += s(attribute);
							}
						}
						prev = attribute;
						return ret;
					}).join("") + "), " + s(attribute.after) + ", " + attribute.value + "]";
				});
			}
			if(sattributes.length) {
				ret.spread = sattributes.map(({space, type, expr}) => `${space}[${mapAttributeType(type)}, ${expr}]`).join(", ");
			}
			if(transitions.length) {
				ret.transitions = transitions.map(({type, name, value}) => `["${type}", ${name}, ${value == '""' ? "{}" : value}]`).join(", ");
			}
			if(visibility) {
				ret.visibility = visibility;
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
					["attrs", "iattrs", "spread", "transitions"].forEach((type, i) => {
						var value = ret[type];
						if(value) {
							str[i] = "[" + value + "]";
						}
					});
					["visibility", "widget", "namespace"].forEach((type, i) => {
						if(ret.hasOwnProperty(type)) {
							str[i + 4] = ret[type];
						}
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

		if(dattributes.root) parent = parent + ".getRootNode({composed: " + (dattributes.composed || "false") + "})";
		else if(dattributes.head) parent = "document.head";
		else if(dattributes.body) parent = "document.body";
		else if(dattributes.parent) parent = dattributes.parent;

		if(parent == "\"\"" || dattributes.orphan) {
			// an empty string and null have the same behaviour but null is faster as it avoids the query selector controls when appending
			parent = "null";
			append = false;
		}

		if(!computed) {
			if(tagName.charAt(0) == ':' && tagName.charAt(1) != ':') {
				var name = tagName.substr(1);
				if(Polyfill.startsWith.call(name, "slot:")) {
					this.warn("Tag name `<:slot[:widget]:name />` is deprecated. Use `<:slot ([widget,] name) />` instead.");
					name = name.substr(5);
					var column = name.indexOf(':');
					if(column == -1) {
						slotName = name;
						tagName = "";
					} else {
						slotName = name.substr(column + 1);
						tagName = name.substring(0, column);
					}
					create = append = false;
				} else if(this.options.aliases && Object.prototype.hasOwnProperty.call(this.options.aliases, name)) {
					var alias = this.options.aliases[name];
					tagName = alias.tagName;
					if(Object.prototype.hasOwnProperty.call(alias, "parent")) parent = alias.parent;
					if(Object.prototype.hasOwnProperty.call(alias, "element")) element = alias.element;
					if(Object.prototype.hasOwnProperty.call(alias, "create")) create = alias.create;
					if(Object.prototype.hasOwnProperty.call(alias, "update")) update = alias.update;
					if(Object.prototype.hasOwnProperty.call(alias, "append")) append = alias.append;
					if(Object.prototype.hasOwnProperty.call(alias, "mode")) newMode = alias.mode;
				} else {
					switch(name) {
						case "window":
						case "document":
							element = name;
							create = append = false;
							break;
						case "root":
							element = element + ".getRootNode({composed: " + (dattributes.composed || "false") + "})";
							create = append = false;
							break;
						case "html":
							element = "document.documentElement";
							create = append = false;
							break;
						case "head":
						case "body":
							element = "document." + name;
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
							element = `super.render(${this.context})`;
							create = append = false;
							break;
						case "fragment":
							updatedElement = element;
							element = "document.createDocumentFragment()";
							create = false;
							break;
						case "shadow":
							element = parent + ".attachShadow({mode: " + (dattributes.mode || "\"open\"") + "})";
							create = update = append = false;
							break;
						case "anchor":
							tagName = ":bind";
							dattributes.to = "[]";
							create = update = append = false;
							break;
						case "use":
							element = parent = arg;
							create = append = false;
							break;
						case "query-all":
							all = true;
						case "query":
							element = `${this.runtime}.query${all ? "All" : ""}(${this.context}, ${arg}, ${parent})`;
							create = append = false;
							break;
						case "adopt-all":
							all = true;
						case "adopt":
							element = arg;
							create = false;
							dattributes.adopt = true;
							break;
						case "slot":
							var column = arg.indexOf(',');
							if(column == -1) {
								slotName = arg.trim();
								tagName = "";
							} else {
								slotName = arg.substr(column + 1).trim();
								tagName = arg.substring(0, column).trim();
							}
							create = append = false;
							break;
						case "inherit":
							var c = currentInheritance = {};
							if(dattributes.level || dattributes.depth) {
								if(!dattributes.level) c.level = [1];
								else if(dattributes.level instanceof Array) c.level = dattributes.level.map(function(a){ return parseInt(a); });
								else c.level = [parseInt(dattributes.level)];
								if(dattributes.depth) {
									var depth = parseInt(dattributes.depth);
									if(isNaN(depth)) this.parser.error("Depth is not a valid number.");
									var levels = [];
									for(var i=0; i<depth; i++) {
										c.level.forEach(function(level){
											levels.push(level + i);
										});
									}
									c.level = levels;
								}
								for(var i=0; i<c.level.length; i++) {
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
						case "scope":
						case "bind":
						default:
							create = update = append = false;
					}
				}
			} else if(tagName.charAt(0) == '#') {
				newMode = modeNames[tagName.substr(1)];
				if(newMode !== undefined) create = update = append = false; // behave as a scope
			} else if(tagName == '@') {
				this.warn("<@ /> tag name is deprecated. Use <:element /> instead.", position);
				create = append = false;
			} else if(tagName) {
				if(Object.prototype.hasOwnProperty.call(this.tagNames, tagName)) this.tagNames[tagName]++;
				else this.tagNames[tagName] = 1;
			}
		}

		if(newMode === undefined) {
			for(var i=0; i<modeRegistry.length; i++) {
				var info = modeRegistry[i];
				if(info.parser.matchesTag && info.parser.matchesTag(tagName, this.currentMode.parser)) {
					newMode = i;
					break;
				}
			}
		}

		if(newMode !== undefined) {
			// every attribute is parsed as JSON, expect an empty string (default value) which is converter to true
			var attributes = {};
			for(var key in dattributes) {
				try {
					var value = JSON.parse(dattributes[key]);
					attributes[key] = value === "" ? true : value;
				} catch(e) {
					// invalid values are ignored
				}
			}
			this.startMode(newMode, attributes);
		}

		if(tagName.charAt(0) != '#') {

			if(!computed && tagName == ":debug" || dattributes["debug"]) {
				this.source.push("if(" + this.runtime + ".isDebug){");
				currentClosing.unshift("}");
			}

			if(dattributes["ref-widget"]) {
				var ref = dattributes["ref-widget"];
				var temp = this.context + ".r";
				if(dattributes.ref instanceof Array) dattributes.ref.push(temp);
				else if(dattributes.ref) dattributes.ref = [dattributes.ref, temp];
				else dattributes.ref = temp;
				this.source.push("(");
				currentClosing.unshift(`,${ref instanceof Array ? ref.join(" = ") : ref} = ${this.runtime}.widget(${temp}), ${temp})`);
			}

			if(dattributes.ref) {
				if(dattributes.ref instanceof Array) this.source.push(dattributes.ref.join(" = "));
				else this.source.push(dattributes.ref);
				this.source.push(" = ");
			}

			if(all) {
				this.source.push(`${this.feature("all")}(this, ${this.context}, ${element}, function(${this.context}){`);
				currentClosing.unshift("})");
				element = this.context + ".element"; // restore default
			}

			if(selector) {
				if(dattributes["query-head"]) queryElement = "document.head";
				else if(dattributes["query-body"]) queryElement = "document.body";
				this.source.push(`${this.feature("deprecatedQuery")}(this, ${this.context}, ${dattributes.query || queryElement || parent}, ${parent}, ${selector}, ${selectorAll}, function(${this.context}){`);
				if(dattributes.adopt || dattributes.clone) {
					parent = this.context + ".parentElement";
					create = false;
					update = append = true;
				}
				currentClosing.unshift("})");
			}

			if(dattributes.unique) {
				this.source.push(`${this.feature("unique")}(this, ${this.context}, ${this.nextId()}, function(){return `);
				currentClosing.unshift("})");
			}

			var before = [], after = [];
			var beforeClosing = "";
			var call = true;
			var inline = false;

			if(tagName == ":bind") {
				this.source.push(this.feature("bind") + "(" + ["this", this.context, dattributes.to].join(", ") +
					", function(" + this.context + (dattributes.as ? ", " + dattributes.as : "") + "){");
				currentClosing.unshift("})");
			}

			if(tagName == ":xml") {
				this.source.push(`(${this.context}.x=${this.feature("xml")}(${dattributes.namespace || "null"}, ${dattributes.root || dattributes.name || "\"xml\""}),`);
				currentClosing.unshift(`,${this.context}.x)`);
				element = `${this.context}.x.firstElementChild`;
				create = false;
			}

			// before
			if(slotName) {
				before.push([this.feature("updateSlot"), options(), '"' + tagName + '"', '"' + slotName + '"', "function(" + this.context + "){"]);
				call = append = false;
				beforeClosing += "}";
			} else if(dattributes.clone) {
				before.push([this.feature("clone"), options()]);
			} else if(optional) {
				before.push([this.feature("createOrUpdate"), element, computed ? tagName : '"' + tagName + '"', options()]);
			} else if(create) {
				if(computed || this.options.widgets && this.options.widgets.indexOf(tagName) != -1) {
					before.push([this.feature("createComputed"), tagName, JSON.stringify(tagName), options()]);
				} else {
					before.push([this.feature("create"), `"${tagName}"`, options()]);
				}
			} else if(update) {
				var optString = options().toString();
				if(optString.length > 2) {
					// only trigger update if needed
					before.push([this.feature("update"), optString]);
				}
			}
			if(dattributes.clear) {
				before.push([this.feature("clear")]);
			}

			// after
			if(forms.length) {
				var v = this.value;
				after.push([this.feature("forms"), forms.map(function(value){
					value.push("function(" + v + "){" + value.pop() + "=" + v + "}");
					return "[" + value.join(", ") + "]";
				}).join(", ")]);
			}
			if(append) {
				var data = [this.feature("append"), parent];
				if(optional) data[0] = (updatedElement || element) + " ? " + this.feature("nop") + " : " + this.feature("append");
				var options = [];
				var aa = this.currentMode.parser.afterappend();
				var br = this.currentMode.parser.beforeremove();
				if(aa) options.push("aa:" + aa);
				if(br) options.push("br:" + br);
				if(dattributes.adopt) options.push("adoption:true");
				if(options.length) data.push("{" + options.join(", ") + "}");
				after.push(data);
			}

			if(next == '/') {
				this.parser.expect('>');
				inline = true;
				call = false;
			}
			if(!(dattributes.slot instanceof Array)) dattributes.slot = dattributes.slot ? [dattributes.slot] : [];
			if(dattributes["slot-content"]) dattributes.slot.push(this.runtime + ".SL_CONTENT");
			if(dattributes["slot-container"]) dattributes.slot.push(this.runtime + ".SL_CONTAINER");
			if(dattributes["slot-input"]) dattributes.slot.push(this.runtime + ".SL_INPUT");
			if(before && (call || dattributes.slot.length)) {
				// create body
				before.push([this.feature("body"), "function(" + this.context + "){"]);
				beforeClosing += "}";
			}

			var runtime = this.runtime;
			var mapNext = a => `, [${a.join(", ")}]`;

			if(before.length || after.length) {
				this.source.push(this.runtime + "(this, " + this.context + ", " + element + before.map(mapNext).join("").slice(0, -1));
				currentClosing.unshift((before.length ? "]" : "") + after.map(mapNext).join("") + skipped + ")");
			} else {
				this.source.push(parent + skipped);
			}

			currentClosing.unshift(beforeClosing);

			if(dattributes.slot.length) {
				this.source.push(this.context + ".registry.addAll(null, [" + dattributes.slot.map(a => a === true ? 0 : a).join(", ") + "], " + this.context + ".element);");
			}

			if(!inline) {

				if(currentInheritance) {
					currentInheritance.index = this.inheritCount++;
					this.source.push(this.inheritance + ".push(" + options(true) + ")");
				} else if(currentNamespace) {
					currentInheritance = {index: this.inheritCount++};
					this.source.push(this.inheritance + ".push([,,,,," + currentNamespace + "])");
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
				mode: newMode !== undefined
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
	while(true) {
		var ret = {};
		if(ret.name = this.parser.readComputedExpr()) {
			attr.computed = ret.computed = true;
			if(ret.name.charAt(0) == '[' && ret.name.charAt(ret.name.length - 1) == ']') {
				ret.name = ret.name.slice(1, -1);
				ret.name = this.runtime + ".config.shortcut" + (ret.name.charAt(0) == '[' ? "" : ".") + ret.name;
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
		attr.parts.forEach(function(part){
			if(part.computed) names.push('(' + part.name + ')');
			else names.push(JSON.stringify(part.name));
		});
		attr.name = `${this.feature("attr")}(${names.join(", ")})`;
	} else {
		attr.name = attr.parts.map(function(part){ return part.name }).join("");
	}
};

/**
 * @since 0.84.0
 */
Transpiler.prototype.stringifyAttribute = function(attr){
	return attr.computed ? attr.name : '"' + attr.name + '"';
};

/**
 * @since 0.67.0
 */
Transpiler.prototype.feature = function(name){
	this.features[name] = true;
	return this.runtime + "." + name;
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

	this.count = hash((this.options.namespace || this.options.filename) + "") % 100000;
	
	this.runtime = this.nextVar();
	this.context = this.nextVar();
	this.inheritance = this.nextVar();
	this.value = this.nextVar();

	this.tagNames = {};
	var features = this.features = {};

	this.warnings = [];
	
	var v = typeof Transpiler != "undefined" && Transpiler.VERSION || version && version.version;
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
	this.before += `var ${this.inheritance}=[];var ${this.context}=${this.runtime}.init(${this.count});`;
	if(!this.options.hasOwnProperty("versionCheck") || this.options.versionCheck) this.before += `${this.runtime}.check("${v}");`;
	this.source = [];

	if(this.options.scope) this.before += this.context + ".element=" + this.options.scope + ";";
	
	this.tags = [];
	this.inherit = [];
	this.inheritCount = 0;
	this.closing = [];
	this.modes = [];
	this.currentMode;

	this.level = 0;
	
	this.startMode(this.options.mode && modeNames[this.options.mode] || defaultMode, this.options.modeAttributes || {}).start();
	
	var open = Transpiler.prototype.open.bind(this);
	var close = Transpiler.prototype.close.bind(this);

	while(!this.parser.eof()) {
		this.updateTemplateLiteralParser();
		this.currentMode.parser.parse(open, close);
	}
	
	this.endMode();

	if(!noenv) this.after += "});";

	var source = this.source.join("");

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
			context: this.context,
			inheritance: this.inheritance,
			value: this.value
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
	// core
	create: ["update"],
	createComputed: ["create"],
	createOrUpdate: ["create", "update"],
	clone: ["update"],
	updateSlot: ["update"],
	appendAnchor: ["update"],
	mixin: ["append", "html"],
	comment: ["append"],
	// bind
	bind: ["anchor"],
	bindIf: ["bind"],
	bindEach: ["bind"],
	// observable
	maybeComputedObservable: ["filterObservables", "computedObservable"],
	// cssb
	convertStyle: ["compileStyle"],
	compileAndBindStyle: ["convertStyle"],
};

if(typeof window == "object") {

	/**
	 * @since 0.125.0
	 */
	Transpiler.eval = function(source){
		return eval.call(window, new Transpiler({versionCheck: false, mode: "auto-code"}).transpile(source).source.all);
	};

	var count = 0;

	function evalScripts() {
		Array.prototype.forEach.call(document.querySelectorAll("script[type='text/x-sactory'], style[type='text/x-sactory']"), function(builder){
			var id = count++ + "";
			var content;
			if(builder.tagName == "STYLE") {
				builder.removeAttribute("type");
				content = builder.outerHTML;
				builder.setAttribute("type", "text/x-sactory");
			}
			builder.setAttribute("data-sactory-from", id);
			builder.setAttribute("data-to", `[data-sactory-to='${id}']`);
			var script = document.createElement("script");
			script.setAttribute("data-sactory-to", id);
			script.setAttribute("data-from", `[data-sactory-from='${id}']`);
			var attributes = {};
			Array.prototype.forEach.call(builder.attributes, function(attr){
				if(Polyfill.startsWith.call(attr.name, "mode:")) {
					attributes[attr.name.substr(5)] = true;
				}
			});
			var transpiler = new Transpiler({
				namespace: id,
				mode: builder.getAttribute("mode"),
				modeAttributes: attributes
			});
			var result = transpiler.transpile(content || builder.textContent);
			var currentScript = transpiler.nextVarName();
			script.textContent =
				result.source.before +
				"var " + currentScript + "=document.querySelector(\"[data-sactory-from='" + id + "']\");" +
				result.variables.context + ".element=" + currentScript + "&&" + currentScript + ".parentNode;" +
				result.variables.context + ".anchor=" + currentScript + "&&" + currentScript + ".nextSibling;" +
				result.source.contentOnly + 
				result.source.after;
			document.head.appendChild(script);
		});
	}
	
	if(document.readyState == "complete") {
		evalScripts();
	} else {
		window.addEventListener("load", evalScripts);
	}
	
}

module.exports = Transpiler;
	