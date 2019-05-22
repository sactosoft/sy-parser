window.onload = function(){

	var alignment = **"y";

	var file, key, hash = null;

	var tab = **("output", "current_tab");

	function switchTab(from, to) {
		if(*tab == from) *tab = to;
	}

	tab.subscribe(function(value){
		<"nav .item.active" -class="active" />
		<{"nav .item." + value} +class="active" />
	});

	var input, output;

	var es6 = true;
	try {
		eval("class Test {}");
	} catch(e) {
		es6 = false;
	}

	var defaultContent = "var name = **\"world\";\n\n<h1 @text=" + (es6 ? "`Hello, ${*name}!`" : "(\"Hello, \" + *name)") + " />\n";

	if(window.location.hash) {
		hash = JSON.parse(atob(window.location.hash.substr(1)));
	} else {
		file = **("snippet", "current_snippet");
		key = **("storage." + *file);
	}

	var content = hash ? **(hash.content) : **(defaultContent, ***key);
	var result = **((function(){
		console.clear();
		try {
			var ret = new Transpiler().transpile(*content, {scope: "document.body"});
			switchTab("error", "output");
			return ret;
		} catch(e) {
			switchTab("output", "error");
			return {error: e, compileError: true};
		}
	})());

	if(!hash) {
		file.subscribe(function(value){
			content.internal.storage.key = ***key;
			var set = content.internal.storage.set;
			content.internal.storage.set = function(){}; // disable saving
			input.setValue(*content = content.internal.storage.get(defaultContent));
			content.internal.storage.set = set; // enable saving
		});
	}

	<style :head>
		var fontFamily = "Segoe UI";
		body {
			margin: 0;
			font-family: ${fontFamily};
			overflow-y: hidden;
		}
		.top {
			.filename {
				span, input, select {
					font-family: ${fontFamily};
					height: 26px;
					margin: 4px 0 4px 4px;
					padding: 0 8px;
				}
			}
			.editor {
				height: calc(100% - 34px);
			}
		}
		.bottom {
			nav {
				.item {
					position: relative;
					cursor: pointer;
					padding: 8px;
					&:hover::after, &.active::after {
						content: '';
						position: absolute;
						bottom: -2px;
						left: 0;
						right: 0;
						height: 4px;
					}
					&:not(.active):hover::after {
						opacity: .5;
						background: darkviolet;
					}
					&.active::after {
						background: darkviolet;
					}
					.has-errors &.error, .has-warnings &.warn {
						&::before {
							content: '• ';
							color: red;
							font-weight: bold;
						}
					}
				}
			}
			.result {
				height: calc(100% - 40px);
			}
		}
		.x {
			.top, .bottom {
				width: 50%;
				height: 100vh;
			}
		}
		.y {
			.top, .bottom {
				height: 50vh;
			}
		}
		.CodeMirror {
			height: 100%;
			border-top: 1px solid silver;
			border-bottom: 1px solid silver;
		}
		.text {
			margin: 8px;
			width: calc(100% - 16px);
			height: calc(100% - 16px);
			border: none;
			font-family: monospace;
			&:focus {
				outline: none;
			}
		}
	</style>
	
	<:body +class=*alignment +class=(*result.error ? "has-errors" : "") +class=(*result.warnings && *result.warnings.length ? "has-warnings" : "")>

		<section class="top">
			<section class="filename">
				if(hash) {
					<span @text=hash.name />
				} else {
					<input *value=*file />
					if(window.localStorage) {
						<select *value=*file>
							Object.keys(window.localStorage).sort().forEach(function(key){
								if(key.substr(0, 8) == "storage.") <option value=key.substr(8) @text=key.substr(8) />
							});
						</select>
					}
				}
			</section>
			<section class="editor">
				input = <textarea style="width:100%;height:360px;font-family:monospace" *value=*content />
			</section>
		</section>

		<section class="bottom" :append>

			<nav>
				<div style="margin:8px 0 10px">
					<span class="item output" @text="Output" +click={ *tab = "output"} />
					<span class="item error" @text="Errors" +click={ *tab = "error"} />
					<span class="item warn" @text="Warnings" +click={ *tab = "warn"} />
					<span class="item code" @text="Transpiled Code" +click={ *tab = "code"} />
					<span class="item info" @text="Info" +click={ *tab = "info"} />
				</div>
			</nav>

			<section class="result" @visible=(*tab == "output") :append>
				<:bind-if :condition={ !*result.error } >
					var container = <iframe style="width:100%;height:100%;border:none" />
					<script @=container.contentWindow.document.head async src="../dist/sactory.js" />.onload = function(){
						window.sandbox = container.contentWindow;
						try {
							container.contentWindow.eval(*result.source.all);
						} catch(e) {
							console.error(e);
							*result.error = e;
						}
					};
				</:bind-if>
			</section>

			<section @visible=(*tab == "error")>
				<textarea class="text" style="color:red" readonly @value=(*result.error || "") />
			</section>

			<section @visible=(*tab == "warn")>
				<textarea class="text" readonly @value=(*result.warnings ? *result.warnings.join('\n') : "") />
			</section>

			<section class="result" @visible=(*tab == "code")>
				output = <textarea style="width:100%;height:180px" @value=(*result.source && *result.source.contentOnly) />
			</section>

			<section @visible=(*tab == "info")>
				<textarea class="text" readonly @value=(*result.compileError ? "" : JSON.stringify(*result, function(key, value){
					return key == "source" || key == "error" || key == "warnings" ? undefined : value;
				}, 4)) />
			</section>

		</section>

	</:body>

	input = CodeMirror.fromTextArea(input, {
		lineNumbers: true,
		indentWithTabs: true,
		smartIndent: false,
		lineWrapping: true
	});
	input.on("change", function(editor){
		/*<".CodeMirror .error" -class="error" />
		<".CodeMirror .warn" -class="warn" />*/
		*content = editor.getValue();
	});

	output = CodeMirror.fromTextArea(output, {
		lineNumbers: true,
		lineWrapping: true,
		readOnly: true
	});

	function checkErrors(value) {
		var error = value.error && value.error.toString().match(/^ParserError: Line (\d+), Column (\d+):/);
		if(error) {
			<style :head :unique>
				.CodeMirror .error {
					background: red;
					.CodeMirror-gutter-elt {
						color: white;
					}
				}
			</style>
			input.addLineClass(parseInt(error[1]) - 1, "gutter", "error");
		}
	}

	result.subscribe(function(value){
		checkErrors(value);
		output.setValue(value.source ? value.source.contentOnly : "");
	});

	checkErrors(*result);

	// add active class to current tab

	<{"nav .item." + *tab} +class="active" />

};
