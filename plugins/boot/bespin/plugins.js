/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Bespin.
 *
 * The Initial Developer of the Original Code is
 * Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Bespin Team (bespin@mozilla.com)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

require("globals");

var Promise = require("promise").Promise;
var builtins = require("builtins");
var console = require("console").console;
var util = require("util/util");
var $ = require("jquery").$;

var r = require;

var loader = require.loader;
var browser = loader.sources[0];

/**
 * Split an extension pointer from module/path#objectName into an object of the
 * type { modName:"module/path", objName:"objectName" } using a pluginName
 * as the base to which roots the pointer
 */
var _splitPointer = function(pluginName, pointer) {
    if (!pointer) {
        return undefined;
    }

    var parts = pointer.split("#");
    var modName;

    // this allows syntax like #foo
    // which is equivalent to PluginName:index#foo
    if (parts[0]) {
        modName = pluginName + ":" + parts[0];
    } else {
        modName = pluginName;
    }

    return {
        modName: modName,
        objName: parts[1]
    };
};

var _retrieveObject = function(pointerObj) {
    var module = r(pointerObj.modName);
    if (pointerObj.objName) {
        return module[pointerObj.objName];
    }
    return module;
};

exports.Extension = function(metadata) {
    for (var key in metadata) {
        this[key] = metadata[key];
    }
    
    this._observers = [];
};

exports.Extension.prototype = {
    _getPointer: function(property) {
        property = property || "pointer";
        return _splitPointer(this._pluginName, this[property]);
    },

    load: function(callback, property) {
        var pointer = this._getPointer(property);

        if (!pointer) {
            console.error("Extension cannot be loaded because it has no 'pointer'");
            console.log(this);
            return null;
        }

        var promise = new Promise();
        require.ensurePackage(this._pluginName, function() {
            require.ensure(pointer.modName, function() {
                var module = r(pointer.modName);
                var data;
                if (pointer.objName) {
                    data = module[pointer.objName];
                } else {
                    data = module;
                }

                if (callback) {
                    callback(data);
                }
                promise.resolve(data);
            });
        });

        return promise;
    },

    /*
     * Loads this extension and passes the result to the callback.
     * Any time this extension changes, the callback is called with
     * the new value. Note that if this extension goes away, the
     * callback will be called with undefined.
     *
     * observingPlugin is required, because if that plugin is
     * torn down, all of its observing callbacks need to be torn down
     * as well.
     */
    observe: function(observingPlugin, callback, property) {
        this._observers.push({plugin: observingPlugin,
            callback: callback, property: property});
        this.load(callback, property);
    },

    /**
     * Returns the name of the plugin that provides this extension.
     */
    getPluginName: function() {
        return this._pluginName;
    },

    _getLoaded: function(property) {
        var pointer = this._getPointer(property);
        return _retrieveObject(pointer);
    }
};

exports.ExtensionPoint = function(name, catalog) {
    this.name = name;
    this.catalog = catalog;
    this.extensions = [];
    this.handlers = [];
};

exports.ExtensionPoint.prototype = {
    /**
    * Retrieves the list of plugins which provide extensions
    * for this extension point.
    */
    getImplementingPlugins: function() {
        var pluginSet = {};
        this.extensions.forEach(function(ext) {
            pluginSet[ext._pluginName] = true;
        });
        var matches = Object.keys(pluginSet);
        matches.sort();
        return matches;
    },
    
    /*
     * get the name of the plugin that defines this extension point.
     */
    getDefiningPluginName: function() {
        return this._pluginName;
    },

    /**
     * If we are keeping an index (an indexOn property is set on the
     * extension point), you can look up an extension by key.
     */
    getByKey: function(key) {
        var indexOn = this.indexOn;

        if (!indexOn) {
            return undefined;
        }

        for (var i = 0; i < this.extensions.length; i++) {
            if (this.extensions[i][indexOn] == key) {
                return this.extensions[i];
            }
        }
        return undefined;
    },

    register: function(extension) {
        this.extensions.push(extension);
        this.handlers.forEach(function(handler) {
            if (handler.register) {
                handler.load(function(register) {
                    if (!register) {
                        console.error('missing register function for pluginName=', extension._pluginName, ", extension=", extension.name);
                    } else {
                         register(extension);
                    }
                }, "register");
            }
        });
    },

    unregister: function(extension) {
        this.extensions.removeObject(extension);
        this.handlers.forEach(function(handler) {
            if (handler.unregister) {
                handler.load(function(unregister) {
                    if (!unregister) {
                        console.error('missing unregister function for pluginName=', extension._pluginName, ", extension=", extension.name);
                    } else {
                         unregister(extension);
                    }
                }, "unregister");
            }
        });
    },

    /**
     * Order the extensions by a plugin order.
     */
    orderExtensions: function(pluginOrder) {
        var orderedExt = [];
        var n;

        for (var i = 0; i < pluginOrder.length; i++) {
            n = 0;
            while (n != this.extensions.length) {
                if (this.extensions[n]._pluginName === pluginOrder[i]) {
                    orderedExt.push(this.extensions[n]);
                    this.extensions.splice(n, 1);
                } else {
                    n ++;
                }
            }
        }

        this.extensions = orderedExt.concat(this.extensions);
    }
};

exports.Plugin = function(md) {
    for (var key in md) {
        this[key] = md[key];
    }
};

exports.Plugin.prototype = {
    register: function() {
        var provides = this.provides;
        var self = this;
        this.provides.forEach(function(extension) {
            var ep = self.catalog.getExtensionPoint(extension.ep, true);
            ep.register(extension);
        });
    },

    unregister: function() {
        var provides = this.provides;
        var self = this;
        this.provides.forEach(function(extension) {
            var ep = self.catalog.getExtensionPoint(extension.ep, true);
            ep.unregister(extension);
        });
    },

    _getObservers: function() {
        var result = {};
        this.provides.forEach(function(extension) {
            console.log("ep: ", extension.ep);
            console.log(extension._observers);
            result[extension.ep] = extension._observers;
        });
        return result;
    },

    /*
    * Figure out which plugins depend on a given plugin. This
    * will allow the reload behavior to unregister/reregister
    * all of the plugins that depend on the one being reloaded.
    */
    _findDependents: function(pluginList, dependents) {
        var pluginName = this.name;
        var self = this;
        pluginList.forEach(function(testPluginName) {
            if (testPluginName == pluginName) {
                return;
            }
            var plugin = self.catalog.plugins[testPluginName];
            if (plugin && plugin.dependencies) {
                for (dependName in plugin.dependencies) {
                    if (dependName == pluginName && !dependents[testPluginName]) {
                        dependents[testPluginName] = {
                            keepModule: false
                        };
                        plugin._findDependents(pluginList, dependents);
                    }
                }
            }
        });
    },

    /*
     * removes the plugin from Tiki's registries.
     */
    _cleanup: function() {
        var pluginName = this.name;

        // Remove the css files.
        this.stylesheets.forEach(function(stylesheet) {
            var links = document.getElementsByTagName('link');
            for (var i = 0; i < links.length; i++) {
                if (links[i].href.indexOf(stylesheet.url) != -1) {
                    links[i].parentNode.removeChild(links[i]);
                    break;
                }
            }
        });

        // remove all traces of the plugin
        // TODO
    },

    /**
     * reloads the plugin and reinitializes all
     * dependent plugins
     */
    reload: function(callback) {
        // TODO: Broken. Needs to be updated to the latest Tiki.

        var func, dependName;

        // All reloadable plugins will have a reloadURL
        if (!this.reloadURL) {
            return;
        }

        var pluginName = this.name;

        var reloadPointer = this.reloadPointer;
        if (reloadPointer) {
            var pointer = _splitPointer(pluginName, reloadPointer);
            func = _retrieveObject(pointer);
            if (func) {
                func();
            } else {
                console.error("Reload function could not be loaded. Aborting reload.");
                return;
            }
        }

        // find all of the dependents recursively so that
        // they can all be unregisterd
        var dependents = {};

        var self = this;

        var pluginList = Object.keys(this.catalog.plugins);

        this._findDependents(pluginList, dependents);

        var reloadDescription = {
            pluginName: pluginName,
            dependents: dependents
        };

        for (dependName in dependents) {
            var plugin = this.catalog.plugins[dependName];
            if (plugin.preRefresh) {
                var parts = _splitPointer(dependName, plugin.preRefresh);
                func = _retrieveObject(parts);
                if (func) {
                    // the preRefresh call can return an object
                    // that includes attributes:
                    // keepModule (true to keep the module object)
                    // callPointer (pointer to call at the end of reloading)
                    dependents[dependName] = func(reloadDescription);
                }
            }
        }

        // notify everyone that this plugin is going away
        this.unregister();

        for (dependName in dependents) {
            this.catalog.plugins[dependName].unregister();
        }

        this._cleanup(pluginName);

        // clear the sandbox of modules from all of the dependent plugins
        var fullModList = [];
        var sandbox = tiki.sandbox;

        var i = sandbox.modules.length;
        var dependRegexes = [];
        for (dependName in dependents) {
            // check to see if the module stated that it shouldn't be
            // refreshed
            if (!dependents[dependName].keepModule) {
                dependRegexes.push(new RegExp("^" + dependName + ":"));
            }
        }

        var nameMatch = new RegExp("^" + pluginName + ":");

        while (--i >= 0) {
            var item = sandbox.modules[i];
            if (nameMatch.exec(item)) {
                fullModList.push(item);
            } else {
                var j = dependRegexes.length;
                while (--j >= 0) {
                    if (dependRegexes[j].exec(item)) {
                        fullModList.push(item);
                        break;
                    }
                }
            }
        }

        // make a private Tiki call that clears these
        // modules from the module cache in the sandbox.
        // the guard below is very important. If it is
        // omitted and there are no modules that need
        // clearing, the entire sandbox is cleared.
        if (fullModList.length > 0) {
            sandbox.clear.apply(sandbox, fullModList);
        }

        // reload the plugin metadata
        this.catalog.loadMetadataFromURL(this.reloadURL).then(
            function() {
                // actually load the plugin, so that it's ready
                // for any dependent plugins
                tiki.async(pluginName).then(function() {
                    // reregister all of the dependent plugins
                    for (dependName in dependents) {
                        self.catalog.plugins[dependName].register();
                    }

                    for (dependName in dependents) {
                        if (dependents[dependName].callPointer) {
                            var parts = _splitPointer(dependName,
                                dependents[dependName].callPointer);
                            func = _retrieveObject(parts);
                            if (func) {
                                func(reloadDescription);
                            }
                        }
                    }

                    if (callback) {
                        // at long last, reloading is done.
                        callback();
                    }
                });
            }, function() {
                // TODO: There should be more error handling then just logging
                // to the command line.
                console.error('Failed to load metadata from ' + self.reloadURL);
            }
        );
    }
};

exports.Catalog = function() {
    this.points = {};
    this.plugins = {};
    this.deactivatedPlugins = {};
    this._extensionsOrdering = [];

    // set up the "extensionpoint" extension point.
    // it indexes on name.
    var ep = this.getExtensionPoint("extensionpoint", true);
    ep.indexOn = "name";
    this.loadMetadata(builtins.metadata);
};

exports.Catalog.prototype = {
    /**
     * Retrieve a registered singleton. Returns undefined
     * if that factory is not registered.
     */
    getObject: function(name) {
        var ext = this.getExtensionByKey("factory", name);
        if (ext === undefined) {
            return undefined;
        }

        var obj = ext.instance;
        if (obj) {
            return obj;
        }

        var exported = ext._getLoaded();
        var action = ext.action;

        if (action == "call") {
            obj = exported();
        } else if (action == "create") {
            obj = exported.create();
        } else if (action == "new") {
            obj = new exported();
        } else if (action == "value") {
            obj = exported;
        } else {
            throw new Error("Create action must be call|create|new|value. " +
                    "Found" + action);
        }

        ext.instance = obj;
        return obj;
    },

    /** Retrieve an extension point object by name, optionally creating it if it
    * does not exist.
    */
    getExtensionPoint: function(name, create) {
        if (create && this.points[name] === undefined) {
            this.points[name] = new exports.ExtensionPoint(name, this);
        }
        return this.points[name];
    },

    /**
     * Retrieve the list of extensions for the named extension point.
     * If none are defined, this will return an empty array.
     */
    getExtensions: function(name) {
        var ep = this.getExtensionPoint(name);
        if (ep === undefined) {
            return [];
        }
        return ep.extensions;
    },

    /**
     * Sets the order of the plugin's extensions. Note that this orders *only*
     * Extensions and nothing else (load order of CSS files e.g.)
     */
    orderExtensions: function(pluginOrder) {
        pluginOrder = pluginOrder || this._extensionsOrdering;

        for (name in this.points) {
            this.points[name].orderExtensions(pluginOrder);
        }
        this._extensionsOrdering = pluginOrder;
    },

    /**
     * Returns the current plugin exentions ordering.
     */
    getExtensionsOrdering: function() {
        return this._extensionsOrdering;
    },

    /**
     * Look up an extension in an indexed extension point by the given key. If
     * the extension point or the key are unknown, undefined will be returned.
     */
    getExtensionByKey: function(name, key) {
        var ep = this.getExtensionPoint(name);
        if (ep === undefined) {
            return undefined;
        }

        return ep.getByKey(key);
    },

    _registerExtensionPoint: function(extension) {
        var ep = this.getExtensionPoint(extension.name, true);
        ep.description = extension.description;
        ep._pluginName = extension._pluginName;
        ep.params = extension.params;
        ep.handlers.push(extension);
        if (extension.indexOn) {
            ep.indexOn = extension.indexOn;
        }
    },

    _registerExtensionHandler: function(extension) {
        var ep = this.getExtensionPoint(extension.name, true);
        ep.handlers.push(extension);
        if (extension.register) {
            extension.load(function(register) {
                if (!register) {
                    throw extension.name + " is not ready";
                }
                ep.extensions.forEach(function(ext) {
                    register(ext);
                });
            }, "register");
        }

    },

    // Topological sort algorithm from Wikipedia, credited to Tarjan 1976.
    //     http://en.wikipedia.org/wiki/Topological_sort
    _toposort: function(metadata) {
        var sorted = [];
        var visited = {};
        var visit = function(key) {
            if (key in visited || !(key in metadata)) {
                return;
            }

            visited[key] = true;
            var depends = metadata[key].dependencies;
            if (!util.none(depends)) {
                for (var dependName in depends) {
                    visit(dependName);
                }
            }

            sorted.push(key);
        };

        for (var key in metadata) {
            visit(key);
        }

        return sorted;
    },

    loadMetadata: function(metadata) {
        var plugins = this.plugins;

        for (pluginName in metadata) {
            // Skip if the plugin is not activated.
            if (this.deactivatedPlugins[pluginName]) {
                continue;
            }

            var md = metadata[pluginName];
            if (md.errors) {
                console.error("Plugin ", pluginName, " has errors:");
                md.errors.forEach(function(error) {
                    console.error(error);
                });
                delete metadata[pluginName];
                continue;
            }

            if (md.dependencies) {
                md.depends = Object.keys(md.dependencies);
            }

            md.name = pluginName;
            md.version = null;
            console.log("loading metadata for", pluginName, " -> ", md);

            var packageId = browser.canonicalPackageId(pluginName);
            if (packageId === null) {
                browser.register('::' + pluginName, md);
                continue;
            }
        }

        this._toposort(metadata).forEach(function(name) {
            var md = metadata[name];
            var activated = !(this.deactivatedPlugins[name]);

            md.catalog = this;
            md.name = name;
            var plugin = new exports.Plugin(md);
            plugins[name] = plugin;

            // Skip if the plugin is not activated.
            if (md.provides && activated) {
                var provides = md.provides;
                for (var i = 0; i < provides.length; i++) {
                    var extension = new exports.Extension(provides[i]);
                    extension._pluginName = name;
                    provides[i] = extension;
                    var epname = extension.ep;
                    if (epname == "extensionpoint") {
                        this._registerExtensionPoint(extension);
                    } else if (epname == "extensionhandler") {
                        this._registerExtensionHandler(extension);
                    }
                    var ep = this.getExtensionPoint(extension.ep, true);
                    ep.register(extension);
                }
            } else {
                md.provides = [];
            }
        }, this);

        for (pluginName in metadata) {
            this._checkLoops(pluginName, plugins, []);
        }

        this.orderExtensions();
    },

    /**
     * Loads the named plugin, calling the provided callback
     * when the plugin is loaded. This function is a convenience
     * for unusual situations and debugging only. Generally,
     * you should load plugins by calling load() on an Extension
     * object.
     */
    loadPlugin: function(pluginName, callback) {
        require.ensurePackage(pluginName, callback);
    },

    /**
     * Retrieve metadata from the server. Returns a promise that is
     * resolved when the metadata has been loaded.
     */
    loadMetadataFromURL: function(url, type) {
        var pr = new Promise();
        $.ajax({
            url: url,
            type: type || "GET",
            dataType: "json",
            success: function(data, textStatus, xhr) {
                this.loadMetadata(data);
                pr.resolve();
            }.bind(this),
            error: function(xhr, textStatus, errorThrown) {
                pr.reject(errorThrown);
            }
        });
        return pr;
    },

    deactivatePlugin: function(pluginName) {
        var plugins = this.plugins;
        var plugin = plugins[pluginName];
        if (plugin !== undefined) {
            plugin.unregister();
            plugin._cleanup();
        }

        this.deactivatedPlugins[pluginName] = true;
    },

    /**
     * Removes a plugin, unregistering it and cleaning up.
     */
    removePlugin: function(pluginName) {
        var plugins = this.plugins;
        var plugin = plugins[pluginName];
        if (plugin == undefined) {
            throw new Error("Attempted to remove plugin " + pluginName
                                            + " which does not exist.");
        }

        plugin.unregister();
        plugin._cleanup();
        delete plugins[pluginName];
    },

    /**
     * for the given plugin, get the first part of the URL required to
     * get at that plugin's resources (images, etc.).
     */
    getResourceURL: function(pluginName) {
        var plugin = this.plugins[pluginName];
        if (plugin == undefined) {
            return undefined;
        }
        return plugin.resourceURL;
    },

    /**
     * Check the dependency graph to ensure we don't have cycles.
     */
    _checkLoops: function(pluginName, data, trail) {
        var circular = false;
        trail.forEach(function(node) {
            if (pluginName === node) {
                console.error("Circular dependency", pluginName, trail);
                circular = true;
            }
        });
        if (circular) {
            return;
        }
        trail.push(pluginName);
        if (!data[pluginName]) {
            console.error("Missing metadata for ", pluginName);
        } else {
            if (data[pluginName].dependencies) {
                for (var dependency in data[pluginName].dependencies) {
                    var trailClone = trail.slice();
                    this._checkLoops(dependency, data, trailClone);
                }
            }
        }
    },

    /**
     * Retrieve an array of the plugin objects.
     * The opts object can include the following options:
     * onlyType (string): only include plugins of this type
     * sortBy (array): list of keys to sort by (the primary sort is first).
     *                 default is sorted alphabetically by name.
     */
    getPlugins: function(opts) {
        var result = [];
        var onlyType = opts.onlyType;
        var plugins = this.plugins;
        for (var key in plugins) {
            var plugin = plugins[key];

            // apply the filter
            if ((onlyType && plugin.type && plugin.type != onlyType)
                || plugin.name == "bespin") {
                continue;
            }

            result.push(plugin);
        }

        var sortBy = opts.sortBy;
        if (!sortBy) {
            sortBy = ["name"];
        }

        var sortfunc = function(a, b) {
            for (var i = 0; i < sortBy.length; i++) {
                var key = sortBy[i];
                if (a[key] < b[key]) {
                    return -1;
                } else if (b[key] < a[key]) {
                    return 1;
                }
            }
            return 0;
        };

        result.sort(sortfunc);
        return result;
    },

    /**
     * Returns a promise to retrieve the object at the given property path,
     * loading the plugin if necessary.
     */
    loadObjectForPropertyPath: function(path, context) {
        var promise = new Promise();
        var parts = /^([^:]+):([^#]+)#(.*)$/.exec(path);
        if (parts === null) {
            throw new Error("loadObjectForPropertyPath: malformed path: '" +
                path + "'");
        }

        var pluginName = parts[1];
        if (pluginName === "") {
            if (util.none(context)) {
                throw new Error("loadObjectForPropertyPath: no plugin name " +
                    "supplied and no context is present");
            }

            pluginName = context;
        }

        require.ensurePackage(pluginName, function() {
            promise.resolve(SC.objectForPropertyPath(path));
        });

        return promise;
    },

    /**
     * Publish <tt>value</tt> to all plugins that match both <tt>ep</tt> and
     * <tt>key</tt>.
     * @param ep {string} An extension point (indexed by the catalog) to which
     * we publish the information.
     * @param key {string} A key to which we publish (linearly searched, allowing
     * for regex matching).
     * @param value {object} The data to be passed to the subscribing function.
     */
    publish: function(ep, key, value) {
        var subscriptions = this.getExtensions(ep);
        subscriptions.forEach(function(sub) {
            // compile regexes only once
            if (sub.match && !sub.regexp) {
                sub.regexp = new RegExp(sub.match);
            }
            if (sub.regexp && sub.regexp.test(key) || sub.key === key) {
                sub.load().then(function(handler) {
                    handler(key, value);
                });
            }
        });
    },

    /**
     * The subscribe side of #publish for use when the object which will
     * publishes is created dynamically.
     * @param ep The extension point name to subscribe to
     * @param metadata An object containing:
     * <ul>
     * <li>pointer: A function which should be called on matching publish().
     * This can also be specified as a pointer string, however if you can do
     * that, you should be placing the metadata in package.json.
     * <li>key: A string that exactly matches the key passed to the publish()
     * function. For smarter matching, you can use 'match' instead...
     * <li>match: A regexp to be used in place of key
     * </ul>
     */
    registerExtension: function(ep, metadata) {
        var extension = new exports.Extension(metadata);
        extension._pluginName = '__dynamic';
        ep = this.getExtensionPoint(ep);
        ep.register(extension);
    }
};

var _removeFromList = function(regex, array, matchFunc) {
    var i = 0;
    while (i < array.length) {
        if (regex.exec(array[i])) {
            var item = array.splice(i, 1);
            if (matchFunc) {
                matchFunc(item);
            }
            continue;
        }
        i++;
    }
};

var _removeFromObject = function(regex, obj) {
    var keys = Object.keys(obj);
    var i = keys.length;
    while (--i > 0) {
        if (regex.exec(keys[i])) {
            delete obj[keys[i]];
        }
    }
};

exports.catalog = new exports.Catalog();

exports.startupHandler = function(ep) {
    ep.load(function(func) {
        func();
    });
};

exports.getUserPlugins = function() {
    return exports.catalog.getPlugins({onlyType: "user"});
};