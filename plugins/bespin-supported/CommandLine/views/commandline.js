/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied.
 * See the License for the specific language governing rights and
 * limitations under the License.
 *
 * The Original Code is Bespin.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Bespin Team (bespin@mozilla.com)
 *
 * ***** END LICENSE BLOCK ***** */

// This is a plugin

var SC = require("sproutcore/runtime").SC;
var bespin = require("bespin");
var util = require("bespin:util/util");
// var filepopup = require("bespin/editor/filepopup");
var history = require("history");
var keys = require("bespin:util/keys");

/**
 * Add a setting to control the console font size
 */
bespin.get("settings").addSetting({
    name: "consolefontsize",
    type: "number",
    defaultValue: 11
});

/**
 * When we are completing against some type, we need a place to cache the
 * retrieved values
 */
var caches = {};

/**
 * Interface controls the user interface to the command line.
 * Each Interface needs an input element to control, and a canon of commands to
 * delegate work to.
 */
exports.Interface = SC.Object.extend({
    commandLine: null,
    store: null,
    idPrefix: "command_",
    parentElement: document.body,

    styles: { bottom: "100px", left: "31px" },
    nodes: [],
    connections: [],
    subscriptions: [],
    inCommandLine: false,
    history: history.InMemoryHistory.create(),

    /** @see container.js */
    requires: {
        files: "files",
        hub: "hub",
        settings: "settings",
        editor: "editor"
    },

    init: function() {
        this.buildUI();
        this.connectEvents();
        this.hideOutput();
    },

    buildUI: function() {
        // Create the div for hints
        this.commandHint = document.createElement("table");
        this.commandHint.id = this.idPrefix + "hint";
        this.commandHint.cellspacing = 0;
        this.commandHint.style.display = "none";
        this.commandHint.style.bottom = this.styles.bottom;
        this.commandHint.style.left = this.styles.left;
        this.commandHint.style.width = "500px";
        this.parentElement.appendChild(this.commandHint);

        this.nodes.push(this.idPrefix + "hint");

        this.commandHint.innerHTML = '<tr class="command_hint-top">' +
              '<td id="command_hint-topleftcorner"></td>' +
              '<td id="command_hint-topstretch"></td>' +
              '<td id="command_hint-toprightcorner"></td>' +
            '</tr>' +
            '<tr class="command_hint-main">' +
              '<td id="command_hint-leftstretch"></td>' +
              '<td id="command_hint-content"></td>' +
              '<td id="command_hint-rightstretch"></td>' +
            '</tr>';

        this.connect(this.commandHint, "onclick", this, this.hideHint);

        // Create the div for real command output
        // TODO move this into the popup
        this.output = document.createElement("div");
        this.output.id = this.idPrefix + "output";
        this.output.style.display = "none";
        this.parentElement.appendChild(this.output);
        this.nodes.push(this.idPrefix + "output");

        // TOOD move this into the popup
        // The reference pane takes a while to load so we create it here
        this.refNode = document.createElement("iframe");
        this.refNode.style.display = "none";
        this.refNode.id = "popup_refNode";
        document.body.appendChild(this.output);
        this.nodes.push("popup_refNode");

        this.footer = document.createElement("div");
        this.footer.className = "footer";
        this.footer.style.display = "none";
        document.body.appendChild(this.footer);

        var commandline = document.createElement("table");
        commandline.className = "commandline";
        commandline.cellpadding = 0;
        this.footer.appendChild(commandline);

        var tr = document.createElement("tr");

        var td = document.createElement("td");
        td.className = "prompt";
        tr.appendChild(td);
        this.promptimg = document.createElement("img");
        this.promptimg.src = "images/icn_command.png";
        td.appendChild(this.promptimg);

        td = document.createElement("td");
        tr.appendChild(td);
        this.commandLine = document.createElement("input");
        this.commandLine.spellcheck = false;
        td.appendChild(this.commandLine);

        // TODO move this into the popup
        //this.filePanel = new filepopup.FilePanel();
    },

    connect: function(element, event, scope, method) {
        //this.connections.push(dojo.connect(element, event, scope, method));
        SC.Event.add(element, event, scope, method);
    },

    /**
     * Handle key bindings and other events for the command line
     */
    connectEvents: function() {
        this.connect(this.commandLine, "onfocus", this, function() {
            this.hub.publish("cmdline:focus");
            this.inCommandLine = true;
            if (this.promptimg) {
                this.promptimg.src = 'images/icn_command_on.png';
            }
        }.bind(this));

        this.connect(this.commandLine, "onblur", this, function() {
            this.inCommandLine = false;
            if (this.promptimg) {
                this.promptimg.src = 'images/icn_command.png';
            }
        });

        this.connect(this.commandLine, "onkeyup", this, function(e) {
            this._normalizeCommandValue();
            this._findCompletions(e);
        });

        this.connect(this.commandLine, "onkeypress", this, function(e) {
            var key = keys.Key;

            if (e.keyChar == 'j' && (e.ctrlKey || e.metaKey)) { // send back
                if (this.currentPanel != "output") {
                    this.showPanel("output");
                }
                util.stopEvent(e);
                return false;
            } else if (e.keyChar == 'o' && (e.ctrlKey || e.metaKey)) { // send back
                if (this.currentPanel != "files") {
                    this.showPanel("files");
                }
                util.stopEvent(e);
                return false;
            } else if ((e.keyChar == 'n' && e.ctrlKey) || e.keyCode == keys.Key.DOWN_ARROW) {
                var next = this.history.next();
                if (next) {
                    this.commandLine.value = next.typed;
                } else {
                    this.history.pointer = this.history.instructions.length;
                    this.commandLine.value = '';
                }

                util.stopEvent(e);
                return false;
            } else if ((e.keyChar == 'p' && e.ctrlKey) || e.keyCode == keys.Key.UP_ARROW) {
                var prev = this.history.previous();
                if (prev) {
                    this.commandLine.value = prev.typed;
                }

                util.stopEvent(e);
                return false;
            } else if (e.keyChar == 'u' && e.ctrlKey) {
                this.commandLine.value = '';

                util.stopEvent(e);
                return false;
            } else if (e.keyCode == keys.Key.ENTER) {
                var typed = this.commandLine.value;
                this.commandLine.value = '';
                this.executeCommand(typed);

                util.stopEvent(e);
                return false;
            } else if (e.keyCode == keys.Key.TAB) {
                this._complete(e);

                util.stopEvent(e);
                return false;
            } else {
                // pie menu use cases here
                /*
                if (e.keyCode == keys.Key.ESCAPE) {
                    // ESCAPE onkeydown fails on Moz, so we need this. Why?
                    this.hideHint();
                    bespin.getComponent("popup", function(popup) {
                        popup.hide();
                    });
                    util.stopEvent(e);
                    return false;
                }
                */
            }

            return true;
        });

        // ESCAPE onkeypress fails on Safari, so we need this.
        this.connect(this.commandLine, "onkeydown", this, function(e) {
            if (e.keyCode == keys.Key.ESCAPE) {
                this.hideHint();

                bespin.getComponent("popup", function(popup) {
                    popup.hide();
                });
            }
        });

        // If an open file action failed, tell the user.
        this.subscriptions.push(bespin.subscribe("editor:openfile:openfail", function(e) {
            this.showHint('Could not open file: ' + e.filename + " (maybe try &raquo; list)");
        }.bind(this)));

        // The open file action worked, so tell the user
        this.subscriptions.push(bespin.subscribe("editor:openfile:opensuccess", function(e) {
            this.showHint('Loaded file: ' + e.file.name);
        }.bind(this)));

        // When escaped, take out the hints and output
        this.subscriptions.push(bespin.subscribe("ui:escape", function() {
            this.hideHint();
            this.hideOutput();
        }.bind(this)));
    },

    destroy: function() {
        this.subscriptions.forEach(function(sub) {
            console.log("bespin.unsubscribe(", sub, ");");
        });

        this.connections.forEach(function(conn) {
            console.log("dojo.disconnect(", conn, ");");
        });

        this.nodes.forEach(function(nodeId) {
            console.log("skipping: dojo.query('#" + nodeId + "'1).orphan();");
        });
    },

    /**
     * Take focus so we can begin work while the pie is rendering for ex
     */
    focus: function() {
        this.commandLine.focus();
    },

    showUsage: function(command) {
        var usage = command.usage || "no usage information found for " + command.name;
        this.showHint("Usage: " + command.name + " " + usage);
    },

    /**
     * Hints are displayed while typing. They are transient and ignorable.
     * @param html The text/html to display in the hint window
     * @param timeout The time in ms to display the hint for. Default 4600ms.
     * Use -1 to display hint until manually cleared
     */
    showHint: function(html, timeout) {
        if (html == null) {
            console.warning("showHint passed null");
            return;
        }

        var elem = document.getElementById("command_hint-content");

        // this is an uncommon case that comes up if you're
        // using Bespin to edit Bespin.
        if (!elem) {
            return;
        }

        elem.innerHTML = html;
        this.commandHint.style.display = "block";

        if (this.hintTimeout) {
            clearTimeout(this.hintTimeout);
        }

        timeout = timeout || 4600;
        if (timeout != -1) {
            this.hintTimeout = setTimeout(function() {
                this.hideHint();
            }.bind(this), timeout);
        }
    },

    /**
     * Reverse the effects of showHint()
     */
    hideHint: function() {
        this.commandHint.style.display = "none";
        if (this.hintTimeout) {
            clearTimeout(this.hintTimeout);
        }
    },

    /**
     * Show the output area in the given display rectangle
     */
    showOutput: function(panel, coords) {
        this._savedCoords = coords;

        this.showPanel(panel);

        this.focus();

        this.maxInfoHeight = coords.h;
    },

    /*
    * Adjust the output to the new size.
    */
    resize: function(coords) {
        this._savedCoords = coords;
        this.showPanel(this.currentPanel, true);
    },

    showPanel: function(panel, coordChange) {
        var coords = this._savedCoords;

        // TODO: This is probably wrong, we should use getComputedStyle
        var footerHeight = this.footer.style.height + 2;

        this.footer.style.left = coords.l + "px";
        this.footer.style.width = (coords.w - 10) + "px";
        this.footer.style.bottom = (coords.b - footerHeight) + "px";
        this.footer.style.display = "block";

        this.commandHint.style.left = coords.l + "px";
        this.commandHint.style.bottom = coords.b + "px";
        this.commandHint.style.width = coords.w + "px";

        if (this.currentPanel) {
            if (this.currentPanel == panel && !coordChange) {
                return;
            }
            if (this.currentPanel != panel) {
                this.hidePanel(panel);
            }
        }

        if (panel == "output") {
            bespin.getComponent('popup', function(popup) {
                popup.setTitle("Command Line");
            });

            this.output.style.left = coords.l + "px";
            this.output.style.bottom = coords.b + "px";
            this.output.style.width = coords.w + "px";
            this.output.style.height = coords.h + "px";
            this.output.style.display = "block";

            // TODO: only do this if the user doesn't click on an area below (e.g. let them click on a textbox, but not empty space)
            // this.connect(this.output, 'mouseup', this, function(e) {
            //     this.focus();
            // }));
        } else if (panel == "reference") {
            bespin.getComponent('popup', function(popup) {
                popup.setTitle("Reference");
            });
            var url = "https://wiki.mozilla.org/Labs/Bespin";
            var refNode = this.refNode;
            if (refNode.src != url) {
                refNode.src = url;
            }

            refNode.style.left = coords.l + "px";
            refNode.style.top = coords.t + "px";
            refNode.style.width = coords.w + "px";
            refNode.style.height = coords.h + "px";
            refNode.style.position = "absolute";
            refNode.style.borderWidth = "0";
            refNode.style.zIndex = "200";
            refNode.style.display = "block";

            this.connect(refNode, 'mouseup', this, function(e) {
                this.focus();
            });
        } else {
            bespin.getComponent('popup', function(popup) {
                popup.setTitle("File Explorer");
            });
            this.filePanel.show(coords);
            this.connect(this.filePanel, 'mouseup', this, function(e) {
                this.focus();
            });
        }

        this.currentPanel = panel;
    },

    hidePanel: function(panel) {
        if (this.currentPanel == "output") {
            this.output.style.display = "none";
        } else if (this.currentPanel == "files") {
            this.filePanel.hide();
        } else if (this.currentPanel == "reference") {
            this.refNode.style.display = "none";
        }
    },

    /**
     * Reverse the effects of showOutput()
     */
    hideOutput: function() {
        this.commandHint.style.left = "32px";
        this.commandHint.style.bottom = "0px";
        this.commandHint.style.width = "500px";

        this.hidePanel(this.currentPanel);
        this.currentPanel = undefined;

        this.footer.style.left = "-10000px";
        this.footer.style.display = "none";
        this.maxInfoHeight = null;
    },

    /**
     * Instead of doing output by appending strings, commands can pass in a
     * DOM node that they update. It is assumed that commands doing this will
     * provide their own progress indicators.
     */
    setElement: function(element) {
        if (this.executing) {
            this.executing.setElement(element);
        } else {
            console.trace();
            console.debug("orphan command node:", element);
        }
    },

    setCommandText: function(newText) {
        this.commandLine.value = newText;
    },

    appendCommandText: function(moreText) {
        this.commandLine.value = this.commandLine.value + moreText;
    },

    /**
     * Complete the currently executing command with successful output
     */
    addOutput: function(html) {
        if (this.executing) {
            this.executing.addOutput(html);
        } else {
            console.trace();
            console.debug("orphan output:", html);
        }
    },

    /**
     * Complete the currently executing command with error output
     */
    addErrorOutput: function(html) {
        if (this.executing) {
            this.executing.addErrorOutput(html);
        } else {
            console.trace();
            console.debug("orphan error output:", html);
        }
    },

    /**
     * Make the console scroll to the bottom
     */
    scrollConsole: function() {
        // certain browsers have a bug such that scrollHeight is too small
        // when content does not fill the client area of the element
        var scrollHeight = Math.max(this.output.scrollHeight, this.output.clientHeight);
        this.output.scrollTop = scrollHeight - this.output.clientHeight;
    },

    /**
     * Redraw the table of executed commands
     */
    updateOutput: function() {
        var formatTime = function(date) {
            var mins = "0" + date.getMinutes();
            if (mins.length > 2) {
                mins = mins.slice(mins.length - 2);
            }
            var secs = "0" + date.getSeconds();
            if (secs.length > 2) {
                secs = secs.slice(secs.length - 2);
            }
            return date.getHours() + ":" + mins + ":" + secs;
        };

        var size = this.settings.values.consolefontsize;
        var mode = this.settings.values.historytimemode;

        this.output.innerHTML = "";

        var table = document.createElement("table");
        table.className = 'command_table';
        table.style = 'font-size:' + size + 'pt';
        this.output.appendChild(table);

        var count = 1;
        this.history.instructions.forEach(function(instruction) {
            if (!instruction.historical) {
                // The row for the input (i.e. what was typed)
                var rowin = document.createElement("tr");
                rowin.className = 'command_rowin';
                rowin.style.backgroundImage = "url(/images/instruction" + size + ".png)",
                rowin.onclick = function() {
                    // A single click on an instruction line in the console
                    // copies the command to the command line
                    this.commandLine.value = instruction.typed;
                }.bind(this);
                rowin.ondblclick = function() {
                    // A double click on an instruction line in the console
                    // executes the command
                    this.executeCommand(instruction.typed);
                }.bind(this);
                table.appendChild(rowin);

                // The opening column with time or history number or nothing
                var rowid = document.createElement("td");
                rowid.className = "command_open";
                rowin.appendChild(rowid);

                if (mode == "history") {
                    rowid.innerHTML = count;
                    // TODO: <blush>
                    SC.RenderContext.fn.addClass(rowid, 'command_open_history');
                }
                else if (mode == "time" && instruction.start) {
                    rowid.innerHTML = formatTime(instruction.start);
                    SC.RenderContext.fn.addClass(rowid, 'command_open_time');
                }
                else {
                    SC.RenderContext.fn.addClass(rowid, 'command_open_blank');
                }

                // Cell for the typed command and the hover
                var typed = document.createElement("td");
                typed.className = "command_main";
                rowin.appendChild(typed);

                // The execution time
                var hover = document.createElement("div");
                hover.className = "command_hover";
                typed.appendChild(hover);

                // The execution time
                if (instruction.start && instruction.end) {
                    var div = document.createElement("div");
                    div.className = "command_duration";
                    div.innerHTML = ((instruction.end.getTime() - instruction.start.getTime()) / 1000) + " sec ";
                    hover.appendChild(div);
                }

                // Toggle output display
                var img = document.createElement("img");
                img.src = "/images/" + instruction.hideOutput ? "plus.png" : "minus.png";
                img.style = "vertical-align:middle; padding:2px;";
                img.alt = "Toggle display of the output";
                img.title = "Toggle display of the output";
                img.onclick = function(ev) {
                    instruction.hideOutput = !instruction.hideOutput;
                    this.updateOutput();
                    util.stopEvent(ev);
                }.bind(this);
                hover.appendChild(img);

                // Open/close output
                img = document.createElement("img");
                img.src = "/images/closer.png";
                img.style.verticalAlign = "middle";
                img.style.padding = "2px";
                img.alt = "Remove this command from the history";
                img.title = "Remove this command from the history";
                img.onclick = function(ev) {
                    this.history.remove(instruction);
                    this.updateOutput();
                    util.stopEvent(ev);
                }.bind(this);
                hover.appendChild(img);

                // What the user actually typed
                img = document.createElement("img");
                img.className = "nohover";
                img.src = "/images/prompt1.png";
                typed.appendChild(img);

                img = document.createElement("img");
                img.className = "hover";
                img.src = "/images/prompt2.png";
                typed.appendChild(img);

                var span = document.createElement("span");
                span.innerHTML = instruction.typed;
                span.className = "command_typed";
                typed.appendChild(span);

                // The row for the output (if required)
                if (!instruction.hideOutput) {

                    var rowout = document.createElement("tr");
                    rowout.className = "command_rowout";
                    table.appendChild(rowout);

                    rowout.appendChild(document.createElement("td"));

                    var td = document.createElement("td");
                    td.colSpan = 2;
                    td.className = (instruction.error ? "command_error" : "");
                    rowout.appendChild(td);

                    if (instruction.element) {
                        td.appendChild(instruction.element);
                    } else {
                        var contents = instruction.output || "";
                        if (!instruction.completed) {
                            contents += "<img src='/images/throbber.gif'/> Working ...";
                        }
                        td.innerHTML = contents;
                    }
                }
            }
            count ++;
        }.bind(this));
    },

    /**
     * Toggle font size between 9,11,14 point fonts
     */
    toggleFontSize: function() {
        var setSize = function(size) {
            this.settings.values.consolefontsize = size;
            this.updateOutput();
        }.bind(this);

        var size = this.settings.values.consolefontsize;
        switch (size) {
            case 9: setSize(11); break;
            case 11: setSize(14); break;
            case 14: setSize(9); break;
            default: setSize(11); break;
        }
    },

    /**
     * Toggle the time/history mode
     */
    toggleHistoryTimeMode: function() {
        var setMode = function(mode) {
            this.settings.values.historytimemode = mode;
            this.updateOutput();
        }.bind(this);

        var size = this.settings.values.historytimemode;
        switch (size) {
            case "history": setMode("time"); break;
            case "time": setMode("blank"); break;
            case "blank": setMode("history"); break;
            default: setMode("history"); break;
        }
    },

    /**
     * Complete the current value. Called on TAB to use the completion
     */
    _complete: function(e) {
        var length = this.commandLine.value.length;
        this.commandLine.setSelectionRange(length, length);
    },

    /**
     * Called on alpha key-presses to decide what completions are available.
     */
    _findCompletions: function(e) {
        // The examples suppose that the user typed "vcs clone repo", and left
        // the cursor after the 'p' of repo

        // Calculate the values to fill out a query structure
        var value = this.commandLine.value; // "vcs clone repo"
        var cursorPos = this.commandLine.selectionStart; // 13
        var preCursor = value.substring(0, cursorPos); // "vcs clone rep"

        // Can we route this command?
        var command = this.store.findCommand(value); // clone command
        if (command == null) {
            // TODO: maybe we could do better than this error by telling the
            // user other options, or where in the command we failed???
            this.showHint("No matches");
            SC.RenderContext.fn.addClass(this.commandLine, "commandLineError");
            return;
        }

        // There is no guarantee that the command is now valid, just that we've
        // got something to ask what the options are from here.
        // One of the possibilities is that this is an error, however we're
        // going to default to no error so things don't look bad when deleting
        SC.RenderContext.fn.removeClass(this.commandLine, "commandLineError");

        // TODO: Error. This makes the assumption that we're using the full
        // name and not an alias. How to fix? We could move prefix assignment to
        // this.store.findCommand (see above) which is the only thing really
        // qualified to know, or we could say that the commandline should auto
        // replace aliases for the real versions?
        var prefix = command.getFullCommandName(); // "vcs clone"

        var actionStr = preCursor.substr(prefix.length); // " rep"
        // If we've got an initial space, chop it off and add to the prefix so
        // the cursor position calculation still works
        if (actionStr.charAt(0) == " ") {
            actionStr = actionStr.substr(1); // "rep"
            prefix += " "; // "vcs clone "
        }
        var action = actionStr.split(/\s+/);

        var query = {
            value: value,  // "vcs clone repo"
            parts: value.trim().split(/\s+/), // ["vcs", "clone", "repo"]
            cursorPos: cursorPos, // 13
            preCursor: preCursor, // "vcs clone rep"
            command: command, // clone command
            prefix: prefix, // "vcs repo "
            action: action // [ "rep" ]
        };

        // Delegate the completions to the command
        command.findCompletions(query, function(response) {
            if (response.value != this.commandLine.value ||
                response.cursorPos != this.commandLine.selectionStart) {
                console.log("Command line changed during async operation. Ignoring.");
            }

            // Only obey auto-fill if we are at the end of the line and we're
            // not deleting text
            if (response.autofill &&
                response.cursorPos == this.commandLine.value.length &&
                e.keyCode != keys.Key.BACKSPACE &&
                e.keyCode != keys.Key.DELETE) {
                this.commandLine.value = response.autofill;
                this.commandLine.setSelectionRange(response.value.length, response.autofill.length);
            }

            // Show the hint as to what's next
            if (response.error) {
                this.showHint(response.error);
            } else if (response.hint) {
                this.showHint(response.hint);
            } else {
                this.hideHint();
            }

            // Add or remove the 'error' class to the commandLine element
            (response.error ? SC.RenderContext.fn.addClass : SC.RenderContext.fn.removeClass)(this.commandLine, "commandLineError");

            // Show alternative options
            if (response.options) {
                var intro = "<strong>Alternatives:</strong><br/>";
                if (response.options.length > 10) {
                    var more = "<br/>And " + (response.options.length - 9) + " more ...";
                    response.options = response.options.slice(0, 9);
                    this.showHint(intro + response.options.join('<br/>') + more);
                } else {
                    this.showHint(intro + response.options.join('<br/>'));
                }
            }
        }.bind(this));
    },

    /**
     * If users are allowed to insert multiple consecutive spaces and tabs into
     * the command line then working out how to select things is hard.
     * The ability to do this gains the user nothing, so we check and trim.
     */
    _normalizeCommandValue: function() {
        // Normalize the command line by removing leading spaces, and
        // replacing other repeated whitespace with a single space char
        var value = this.commandLine.value;
        var cursorPos = this.commandLine.selectionStart;
        value = value.replace(/^\s+/, "");
        value = value.replace(/\s+/g, " ");
        if (this.commandLine.value != value) {
            this.commandLine.value = value;
            this.commandLine.setSelectionRange(cursorPos - 1, cursorPos - 1);
        }
    },

    /**
     * For a command to show up in a console, it should be executed through
     * this function.
     */
    executeCommand: function(typed, hidden) {
        if (!typed || typed == "") {
            return null;
        }

        var instruction = new exports.Instruction(this, typed);

        if (hidden !== true) {
            this.history.add(instruction);
        }

        instruction.onOutput(function() {
            this.hideHint();
            this.updateOutput();
            this.scrollConsole();
        }.bind(this));

        instruction.exec();
        return instruction;
    },

    /**
     * Link Function to Instruction
     * Make a function be part of the thread of execution of an instruction
     */
    link: function(action, context) {
        if (!this.executing) {
            if (context == null) {
                return action;
            }
            return function() { action.apply(context, arguments); };
        }

        return this.executing.link(action, context);
    }
});

window.cli = exports.Interface.create();

/**
 * Wrapper for something that the user typed
 */
exports.Instruction = SC.Object.extend({
    init: function(commandLine, typed) {
        this.typed = typed.trim();
        this.output = "";
        this.commandLine = commandLine;

        this._outstanding = 0;
        this._callbacks = [];

        // It is valid to not know the commandLine when we are filling the
        // history from disk, but in that case we don't need to parse it
        if (commandLine != null) {
            this.start = new Date();
            this.completed = false;

            var ca = this._splitCommandAndArgs(commandLine.store, typed);
            if (ca) {
                this.command = ca[0];
                this.args = ca[1];
            }
        } else {
            this.completed = true;
            this.historical = true;
        }
    },

    /**
     * Execute the command
     */
    exec: function() {
        try {
            if (this._parseError) {
                this.addErrorOutput(this._parseError);
            } else {
                this.commandLine.executing = this;
                this.command.execute(this, this.args, this.command);
            }
        }
        catch (ex) {
            if (ex instanceof TypeError) {
                console.error(ex);
            }
            this.addErrorOutput(ex);
        }
        finally {
            this.commandLine.executing = null;

            if (this._outstanding == 0) {
                this.completed = true;
                this._callbacks.forEach(function(callback) {
                    callback();
                });
            }
        }
    },

    /**
     * Link Function to Instruction
     * Make a function be part of the thread of execution of an instruction
     */
    link: function(action, context) {
        this._outstanding++;

        return function() {
            try {
                action.apply(context || window, arguments);
            } finally {
                this._outstanding--;

                if (this._outstanding == 0) {
                    this.completed = true;
                    this._callbacks.forEach(function(callback) {
                        callback();
                    });
                }
            }
        }.bind(this);
    },

    /**
     * A hack to allow an instruction that has called link to forget all the
     * linked functions.
     */
    unlink: function() {
        this._outstanding = 0;
        this.completed = true;
        this._callbacks.forEach(function(callback) {
            callback();
        });
    },

    /**
     * A string version of this Instruction suitable for serialization
     */
    toString: function() {
        return JSON.stringify({
            typed: this.typed,
            output: this.output,
            start: this.start ? this.start.getTime() : -1,
            end: this.end ? this.end.getTime() : -1
        });
    },

    /**
     * Complete the currently executing command with successful output
     */
    addOutput: function(html) {
        if (html && html != "") {
            if (this.output != ""){this.output += "<br/>";}
            this.output += html;
        }

        this.element = null;
        this.hideOutput = false;
        this.end = new Date();

        this._callbacks.forEach(function(callback) {
            callback(html);
        });
    },

    /**
     * Complete the currently executing command with error output
     */
    addErrorOutput: function(html) {
        this.error = true;
        this.addOutput(html);
    },

    /**
     * Complete the currently executing command with usage output
     * TODO: Why do we need to pass the command in?
     */
    addUsageOutput: function(command) {
        this.error = true;
        var usage = command.usage || "no usage information found for " + command.name;
        this.addOutput("Usage: " + command.name + " " + usage);
    },

    /**
     * Monitor output that goes to an instruction
     */
    onOutput: function(callback) {
        // Catch-up on the output so far
        callback.call(null, this.output);

        this._callbacks.push(callback);

        // TODO: return an element to allow us to unregister the listener
    },

    /**
     * Instead of doing output by appending strings, commands can pass in a
     * DOM node that they update. It is assumed that commands doing this will
     * provide their own progress indicators.
     */
    setElement: function(element) {
        this.element = element;
        this.end = new Date();
        this.hideOutput = false;
        this.error = false;
        this.commandLine.showPanel("output");

        this._callbacks.forEach(function(callback) {
            callback();
        });
    },

    /**
     * Split Command and Args
     * Private method to chop up the typed command
     */
    _splitCommandAndArgs: function(store, typed, parent) {
        var data = typed.split(/\s+/);
        var commandname = data.shift();

        var command;
        var argstr = data.join(' ');

        if (store.commands[commandname]) {
            command = store.commands[commandname];
        } else if (store.aliases[commandname]) {
            var alias = store.aliases[commandname].split(' ');
            var aliascmd = alias.shift();
            if (alias.length > 0) {
                argstr = alias.join(' ') + ' ' + argstr;
            }
            command = store.commands[aliascmd];
        } else {
            if (commandname == "") {
                this._parseError = "Missing " + (parent == null ? "command" : "subcommand") + ".<br/>";
            } else {
                this._parseError = "Sorry, no " + (parent == null ? "command" : "subcommand") + " '" + commandname + "'.<br/>";
            }

            // Sometime I hate JavaScript ...
            var length = 0;
            for (command in store.commands) {
                length++;
            }

            // TODO: consider promoting this somewhere
            var linkup = function(exec) {
                var script = "bespin.get(\"commandLine\").executeCommand(\"" + exec + "\");";
                return "<a href='javascript:" + script + "'>" + exec + "</a>";
            };

            if (length <= 30) {
                this._parseError += "Try one of: ";
                for (command in store.commands) {
                    this._parseError += store.commands[command].name + ", ";
                }
                if (parent != null) {
                    this._parseError += "<br/>Or use '" + linkup(parent.name + " help") + "'.";
                } else {
                    this._parseError += "<br/>Or use '" + linkup("help") + "'.";
                }
            } else {
                if (parent != null) {
                    this._parseError += "Use '" + linkup(parent.name + " help") + "' to enumerate commands.";
                } else {
                    this._parseError += "Use '" + linkup("help") + "' to enumerate commands.";
                }
            }

            return null;
        }

        if (command.subcommands) {
            if (data.length < 1 || !data[0]) {
                argstr = command.subcommanddefault || 'help';
            }
            return this._splitCommandAndArgs(command.subcommands, argstr, command);
        }

        return [command, store.getArgs(argstr.split(' '), command)];
    }
});