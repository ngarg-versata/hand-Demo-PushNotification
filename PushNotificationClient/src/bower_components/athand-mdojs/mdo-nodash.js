(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD: Register as an anonymous module.
        define(["underscore"], function (_) {
            return factory(_);
        });
    } else {
        // Browser globals
        root.mdo = factory(root._);
    }
}(this, function (_) {
/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../node_modules/almond/almond", function(){});


/*! websql.js | MIT license | http://bitbucket.org/nonplus/websql-js */

/*jslint undef: true, white: true, browser: true, devel: true, indent: 4, sloppy: false */
/*global alert: false, define: true*/

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // When used as AMD, register as an anonymous module.
        define('lib/websql',[], factory);
    } else {
        // Otherwise create browser global `websql`
        root.websql = factory();
    }
} (this, function () {

//      (c) 2012 Stepan Riha
//      websql.js may be freely distributed under the MIT license.
//
// Module that wraps asynchronous WebSQL calls with deferred promises and provides SQL utility
// methods.
//
// Promises are **resolved** when asynchronous database callback is finished.
//
// Promises are **rejected** with an `Error` object that may contain one or more of the following:
//
// * `message`: Describing what failed
// * `exception`: Exception that was thrown
// * `sqlError`: Error returned by WebSQL
// * `sql`: statement that was executing
//
// ## Getting Started
//
// Websql can be loaded as
//
// * a `<script>` tag (creating a `websql` global)
// * an AMD module
//
// Websql can produce deferred promises using
//
// * [`when.js`](https://github.com/cujojs/when)
// * [`Q.js`](https://github.com/kriskowal/q)
// * [`jQuery's Deferred`](http://api.jquery.com/category/deferred-object/)
// * Other...
//
// ### To use in `<script>` tag
//
// The module will autodetect and use one of the supported promise providers
// if it's included in your HTML before `websql`:
//
//          <script src="path/to/when.js"></script>
//          <script src="path/to/websql.js"></script>
//          ...
//
// ### To use as an AMD module
//
// If a promise provider isn't loaded into the global scope, you need to use
// the `websql.config()` method to tell it which provider to use.
//
//          // Using a CommonJS Promisses/A implementation:
//          define(["websql", "when"], function(websql, when) {
//              websql.config({
//                  defer: when.defer
//              });
//              ...
//          })
//
//          // Using jQuery Deferred implementation:
//          define(["websql", "jquery"], function(websql, $) {
//              websql.config({
//                  defer: $.Deferred
//              });
//              ...
//          })
//
//
// ## Using the API
//
// Example:
//
//      var wsdb = websql("test");
//      wsdb.read("SELECT * FROM ...");
//          .then(function(resultSet) { ... });
//
    "use strict";
    var NONE = 0;
    var ERROR = 1;
    var DEBUG = 2;

    var verbosity = NONE;
    var trace = console;
	// Trace executeSql statement information: "sql", "sql-params", "sql-params-full"
	var traceDb = "";
	// Running total count of executed queries
	var globalQueryCount = 0;

    // In the Android browser, requesting a second database with an estimated size
    // larger than the first database fails.
    //
    // We use this variable to request the first database with the
    // largest allowed estimated size (unless the caller specifies otherwise).
    var isFirstOpenDatabaseRequest = true;

    // iOS 7 introduced a bug that causes database requests to fail, if the
    // estimated size of the database forces the user to be prompted
    // for a quota increase
    var hasDbSizeIncreaseBug = navigator.userAgent.match(/(iPad|iPhone);/i);

    // ## Public Methods ##
    //
    // ### websql() or websql(Database) or websql(name, _version_, _displayName_, _estimatedSize_)
    //
    // Constructor for `WebsqlDatabase` wrapper objects.
    //
    // * `websql()` creates an uninitialized instance.  Use the `openDatabase` method to initialize it.
    // * `websql(Database)` creates an instance from an native Database opened via `window.openDatabase(...)`
    // * `websql(name, ...)` takes the same parameters as the `window.openDatabase` function, but supplies
    // default values for unspecified parameters.
    //
    // Returns: new instance of `WebsqlDatabase` wrapper class.
    //
    // Usage:
    //
    //      var wsdb = websql("test", "Test Database", 2 * 1024 * 1024);
    //      wsdb.execute("INSERT INTO ...")
    //          .then(function(resultSet) { ... })
    //
    // More usage:
    //
    //      var wsdb = websql("test");
    //      wsdb.execute("INSERT INTO ...")
    //          .then(function(resultSet) { ... })
    //
    //      var database = window.openDatabase(...);
    //      var wsdb = websql(database);
    //
    function WebsqlDatabase(name, _version_, _displayName_, _estimatedSize_) {

        var db;
        var inProgressBatchXact;
        var self = this;
	    var dbId;
	    var queryCount = 0;

	    if(name.length > 5) {
		    dbId = name.substr(0, 4) + "\u2026";
	    } else {
		    dbId = (name+"    ").substr(0, 5);
	    }

	    function traceExecuteSql(sql, args) {
		    queryCount++;
		    globalQueryCount++;
		    switch(traceDb) {
			    case "sql":
				    trace.log("SQL[" + dbId + "]: " + sql);
				    break;
			    case "sql-params":
				    trace.log("SQL[" + dbId + "]: " + sql);
				    if(args && args.length) {
					    trace.log("   [" + dbId + "]  " + JSON.stringify(args, function(key, val) {
						    if(_isString(val) && val.length > 20) {
							    val = val.substr(0, 20) + "\u2026";
						    }
						    return val;
					    }));
				    }
				    break;
			    case "sql-params-full":
				    trace.log("SQL[" + dbId + "]: " + sql);
				    if(args && args.length) {
					    trace.log("   [" + dbId + "]  " + JSON.stringify(args));
				    }
				    break;
		    }
	    }

        // ### openDatabase(name, _version_, _displayName_, _estimatedSize_) ###
        //
        // Calls window.openDatabase().
        //
        //  * version defaults to `""`
        //  * displayName defaults to `name`
        //  * estimatedSize defaults to `2 * 1024 * 1024`
        //
        // Returns: promise that resolves with this `WebsqlDatabase` instance
        //
        // Usage:
        //
        //      wsdb.openDatabase("test", "Test Database", 2 * 1024 * 1024))
        //          .then(function(wsdb) {...});
        //
        // More usage:
        //
        //      wsdb.openDatabase("test"))
        //          .then(function(wsdb) {...});
        //
        function openDatabase(name, version, displayName, estimatedSize) {
            log(DEBUG, "openDatabase", name, version, displayName, estimatedSize);

            if (!displayName) { displayName = name; }
            if (!version) { version = ""; }
            if (!estimatedSize) {
                var estimatedSizeInMB = hasDbSizeIncreaseBug 
                                            ? 0 
                                            : (isFirstOpenDatabaseRequest ? 45 : 2);

                estimatedSize = estimatedSizeInMB * 1024 * 1024;
            }

            isFirstOpenDatabaseRequest = false;

            var dfd = defer();
            try {
                var openDatabaseCtx;
                if (window.sqlitePlugin) {
                    openDatabaseCtx = window.sqlitePlugin;
                    log(DEBUG, "Opening " + name + " database using native plugin...");
                } else if (window.openDatabase) {
                    openDatabaseCtx = window;
                    log(DEBUG, "Opening " + name + " database using WebSQL...");
                }

                if (openDatabaseCtx) {
                    exports.db = db = openDatabaseCtx.openDatabase(name, version, displayName, estimatedSize);
                    if (db) {
                        log(DEBUG, "Opened " + name + " database");
                        dfd.resolve(self);
                    } else {
                        _rejectError(dfd, "Failed to open database");
                    }

                    db.isDatabase = true;
                    // Native SQLite plugin doesn't support readTransaction
                    db.readTransaction = (db.readTransaction || db.transaction);
                } else {
                    log(ERROR, "WebSQL not implemented");
                    _rejectError(dfd, "WebSQL not implemented");
                }
            } catch (ex) {
                log(ERROR, "Failed to open database " + name);
                _rejectError(dfd, "Failed to open database " + name, { exception: ex });
            }
            exports.promise = promise(dfd);
            return exports.promise;
        }

        // ### changeVersion(oldVersion, newVersion, xactCallback) ###
        //
        // Calls changeVersion(oldVersion, newVersion, xactCallback).
        //
        // Returns: promise that resolves with the changed `WebsqlDatabase`
        //
        // Usage:
        //
        //      wsdb.changeVersion("1", "2",
        //              function (xact) {
        //                  xact.executeSQL(...);
        //              }
        //      ).then(function(wsdb) {...});
        //
        function changeVersion(oldVersion, newVersion, xactCallback) {
            log(DEBUG, "openDatabase", db, oldVersion, newVersion, xactCallback);

            var dfd = defer();
            try {
                if (!_isDatabase(db)) {
                    _rejectError(dfd, "Database not specified (db='" + db + "')");
                } else {
                    db.changeVersion(oldVersion, newVersion, xactCallback,
                        function (sqlError) {
                            log(ERROR, sqlError);
                            _rejectError(dfd, "Failed to change version", { sqlError: sqlError });
                        },
                        function () {
                            log(DEBUG, "SUCCESS changeVersion");
                            dfd.resolve(this);
                        }
                    );
                }
            } catch (ex) {
                log(ERROR, ex);
                _rejectError(dfd, "Failed changeVersion(db, '" + oldVersion + "', '" + newVersion + "'')", { exception: ex });
            }
            return promise(dfd);
        }

        // ### getTables() ###
        //
        // Queries the sqlite_master table for user tables
        //
        // Returns: promise that resolves with an array of table information records
        //
        // Usage:
        //
        //      wsdb.getTables()
        //          .then(function(tables) {
        //          for(var i = 0; i < tables.length; i++) {
        //              var name = tables[i].name;
        //              var sql = tables[i].sql;
        //              ...
        //          }
        //      });
        //
        function getTables() {

            var sql = "SELECT name, type, sql FROM sqlite_master " +
                        "WHERE type in ('table') AND name NOT LIKE '?_?_%' ESCAPE '?'";

            return read(sql, function (rs) {
                var tables = [];
                var rows = rs.rows;
                var i;
                for (i = 0; i < rows.length; i++) {
                    tables.push(rows.item(i));
                }
                return tables;
            });
        }

        // ### tableExists(name) ###
        //
        // Queries the sqlite_master for a table by name
        //
        // Returns: promise that resolves with table info or with `undefined` if table
        // does not exist.
        //
        // Usage:
        //
        //      wsdb.tableExists("person")
        //          .then(function (table) {
        //              if(table) {
        //                  alert("table exists");
        //              } else {
        //                  alert("does not exist");
        //              }
        //          });
        //
        function tableExists(name) {

            var sql = "SELECT * FROM sqlite_master " +
                        "WHERE name = ?";

            return readRow(sql, [name], function (row) {
                return row || undefined;
            });
        }

        // ### destroyDatabase() ###
        //
        // Drops all the tables in the database.
        //
        // Returns: promise that resolves with this `WebsqlDatabase`
        //
        // Usage:
        //
        //      wsdb.destroyDatabase()
        //          .then(function (wsdb) {...});
        //
        function destroyDatabase() {
            return transaction(function (xact) {
                var sql = "SELECT name FROM sqlite_master " +
                            "WHERE type in ('table') AND name NOT LIKE '?_?_%' ESCAPE '?'";
	            traceExecuteSql(sql);
                xact.executeSql(sql, [], function (xact, rs) {
                    var rows = rs.rows;
                    var i;
                    for (i = 0; i < rows.length; i++) {
                        var sql = 'DROP TABLE "' + rows.item(i).name + '"';
	                    traceExecuteSql(sql);
                        xact.executeSql(sql);
                    }
                });
            });
        }

        // ### transaction(xactCallback) ###
        //
        // Calls xactCallback(xact) from within a database transaction
        //
        // Returns: promise that resolves with the database
        //
        // Usage:
        //
        //      wsdb.transaction(
        //              function (xact) {
        //                  xact.executeSQL(...);
        //              }
        //      ).then(function (wsdb) {...});
        //
        // More usage:
        //
        //      var addressId;
        //      var personId;
        //
        //      function insertPerson(xact) {
        //          return xact.executeSql(
        //              "INSERT INTO person ...", [...],
        //              function (xact, rs) {
        //                  personId = rs.insertId;
        //                  insertAddress(xact, personId);
        //              }
        //          )
        //      }
        //
        //      function insertAddress(xact, personId) {
        //          return wsdb.executeSql(xact,
        //              "INSERT INTO address (person, ...) VALUES (?, ...)",
        //              [personId, ...],
        //              function (xact, rs) {
        //                  addressId = rs.insertId;
        //              }
        //          )
        //      }
        //
        //      wsdb.transaction(
        //              function (xact) {
        //                  insertPerson(xact);
        //              }
        //      ).then(function(wsdb) {
        //          alert("Created person " + personId +
        //                  " with address " + addressId);
        //      });
        //
        function transaction(xactCallback) {
            return executeTransaction("transaction", xactCallback);
        }

        // ### readTransaction(xactCallback) ###
        //
        // Calls xactCallback(xact) from within a database read transaction
        //
        // Returns: promise that resolves with the database
        //
        // Usage:
        //
        //      wsdb.readTransaction(
        //              function (xact) {
        //                  xact.executeSQL(...);
        //              }
        //      ).then(function (wsdb) {...});
        //
        function readTransaction(xactCallback) {
            return executeTransaction("readTransaction", xactCallback);
        }

        // ### execute(sqlStatement(s), _args(s)_, _rsCallback_) ###
        //
        // Method for executing a transaction with one or more `sqlStatement`
        // with the specified `args`, calling the `rsCallback` with the result set(s).
        //
        // The `args` and `rsCallback` are optional.
        //
        // * Passing a _single_ `sqlStatement` string with `args` that is an _array of arrays_,
        // the statement is executed with each row in the `args`.
        // * Passing an array of `{ sql, args}` objects to `sqlStatement`
        // executes the `sql` in each row with the row's `args` (or the parameter `args`).
        //
        // Returns: promise that resolves with `rsCallback` result
        // or the resultSet, if no `rsCallback` specified.  If an array of statements or arguments
        // is specified, the promise resolves with an array of results/resultSets.
        //
        // Basic Usage:
        //
        //      wsdb.execute("DELETE FROM person")
        //          .then(function (resultSet) {...});
        //
        // Other Usage:
        //
        //      wsdb.execute(
        //                  "INSERT INTO person (first, last) VALUES (?, ?)",
        //                  ["John", "Doe"],
        //                  function (rs) {
        //                      console.log("Inserted person", rs.insertId);
        //                      return rs.insertId;
        //                  }
        //      ).then(function (result) {...});
        //
        // Other Usage: (single `sqlStatement` with multiple sets of `args`)
        //
        //      wsdb.execute(
        //                  "INSERT INTO person (first, last) VALUES (?, ?)",
        //                  [
        //                      ["John", "Doe"],
        //                      ["Jane", "Doe"]
        //                  ],
        //                  // called for each row in args
        //                  function (rs) {
        //                      console.log("Inserted person", rs.insertId);
        //                      return rs.insertId;
        //                  }
        //      ).then(function (insertIds) {
        //          var personId1 = insertIds[0], personId2 = insertIds[1];
        //          ...
        //      });
        //
        // Other Usage: (multiple `sqlStatement` with multiple sets of `args`)
        //
        //      wsdb.execute(
        //                  [{
        //                      sql: "UPDATE person SET (first=?, last=?) WHERE id=?",
        //                      args: ["Robert", "Smith", 23]
        //                  }, {
        //                      sql: "UPDATE address SET (street=?, city=?, zip=?) WHERE id=?",
        //                      args: ["Sesame St.", "Austin", "78758", 45]
        //
        //                  }],
        //                  // called for each object in args
        //                  function (rs) {
        //                      console.log("Updated object: ", rs.rowsAffected);
        //                      return rs.rowsAffected;
        //                  }
        //      ).then(function (results) {
        //          var numPersons = results[0], numAddresses = results[1];
        //          ...
        //      });
        //
        function execute(sqlStatement, args, rsCallback) {
            return execSqlStatements(transaction, sqlStatement, args, rsCallback);
        }

        // ### read(sqlStatement(s), _args(s)_, _rsCallback_) ###
        //
        // Method for executing a readTransaction with one or more `sqlStatement`
        // with the specified `args`, calling the `rsCallback` with the result set(s).
        //
        // The `args` and `rsCallback` are optional.
        //
        // * Passing a _single_ `sqlStatement` string with `args` that is an _array of arrays_,
        // the statement is executed with each row in the `args`.
        // * Passing an array of `{ sql, args}` objects to `sqlStatement`
        // executes the `sql` in each row with the row's `args` (or the parameter `args`).
        //
        // Returns: promise that resolves with `rsCallback` result
        // or the resultSet, if no `rsCallback` specified.  If an array of statements or arguments
        // is specified, the promise resolves with an array of results/resultSets.
        //
        // Usage:
        //
        //      wsdb.read("SELECT * FROM person WHERE first = ?",
        //                  ["Bob"],
        //                  function (rs) {
        //                      var rows = rs.rows;
        //                      for(var i = 0; i < rows.length; i++) {
        //                          ...
        //                      }
        //                      return result;
        //                  }
        //      ).then(function (result) {...});
        //
        // Other usage:
        //
        //      wsdb.read("SELECT * FROM person WHERE first = ?",
        //                  ["Bob"]
        //      ).then(function (resultSet) {...});
        //
        // Other Usage: (single `sqlStatement` with multiple sets of `args`)
        //
        //      wsdb.read("SELECT * FROM person WHERE first = ?",
        //                  [
        //                      ["Bob"],
        //                      ["John"]
        //                  ],
        //                  // called for each row in args
        //                  function (rs) {
        //                      return rs.rows;
        //                  }
        //      ).then(function (results) {
        //          var bobRows = results[0], johnRows = results[1];
        //          ...
        //      });
        //
        // Other Usage: (multiple `sqlStatement` with multiple sets of `args`)
        //
        //      wsdb.read([{
        //                      sql: "SELECT * FROM person WHERE id=?",
        //                      args: [23]
        //                  }, {
        //                      sql: "SELECT * FROM address WHERE state in (?, ?, ?)",
        //                      args: ["CA", "FL", "TX"]
        //
        //                  }],
        //                  // called for each object in args
        //                  function (rs) {
        //                      return rs.rows;
        //                  }
        //      ).then(function (results) {
        //          var person23rows = results[0], addressRows = results[1];
        //          ...
        //      });
        //
        function read(sqlStatement, args, rsCallback) {
            return execSqlStatements(readTransaction, sqlStatement, args, rsCallback);
        }

        // ### readRow(sqlStatement, _args_, _rowCallback_, _defaultRow_) ###
        //
        // Method for executing a readTransaction with a single `sqlStatement`
        // that's expected to return a single row.
        // The specified `rowCallback` is called with the row in the resultset
        // or with `undefined` if resultSet contains no rows.
        // If the query does not return a row, the `_defaultRow_` is returned instead.
        //
        // The `args`, `rowCallback` and `defaultRow` are optional.
        //
        // Returns: promise that resolves with the `rowCallback` result
        // or the row, if no `rowCallback` specified.
        // If no rows are selected and `rowCallback` isn't specified, the promise
        // resolves with the `defaultRow`.
        // The promise is rejected if the query returns multiple rows or if it returns
        // zero rows and no `rowCallback` and `defaultRow` were specified.
        //
        // Usage:
        //
        //      wsdb.readRow(
        //                  "SELECT * FROM person WHERE id = ?",
        //                  [123],
        //                  function (row) {
        //                      if(!row) {
        //                          // person not found
        //                          return;
        //                      }
        //                      var login = row.login;
        //                      ...
        //                      return result;
        //                  }
        //      ).then(function (result) {...});
        //
        // Other Usage:
        //
        //      wsdb.readRow(
        //                  "SELECT * FROM person WHERE id = ?",
        //                  [123]
        //      ).then(function (row) {...});
        //
        function readRow(sqlStatement) {
            var args, rowCallback, defaultValue;
            var idx = 1;
            if (arguments[idx] instanceof Array) {
                args = arguments[idx++];
            }
            if (arguments[idx] instanceof Function) {
                rowCallback = arguments[idx++];
            }
            if (arguments[idx] instanceof Object) {
                defaultValue = arguments[idx++];
            }

            return pipe(read(sqlStatement, args),
                    function (rs) {
                        var row;
                        if (rs.rows.length > 1) {
                            return _rejectError(defer(), new Error("Query returned " + rs.rows.length + " rows"));
                        }
                        if (rs.rows.length === 0) {
                            if (defaultValue) {
                                row = defaultValue;
                            } else if (rowCallback) {
                                row = rowCallback();
                            } else {
                                return _rejectError(defer(), new Error("Query returned 0 rows"));
                            }
                        } else {
                            row = rs.rows.item(0);
                            if (rowCallback) {
                                row = rowCallback(row);
                            }
                        }
                        return row;
                    });
        }

        // #### executeTransaction(xactType, xactCallback)
        //
        // Call `xactType` method on `db`
        //
        // Implements common behavior for `wsdb.transaction` and `wsdb.readTransaction`
        //
        function executeTransaction(xactType, xactCallback) {
            var dfd = defer();
            log(DEBUG, xactType + ": in");

            try {
                if (!_isDatabase(db)) {
                    _rejectError(dfd, "Database not specified (db='" + db + "')");
                } else {
                    var called = false;

                    db[xactType](function (xact) {
                        called = true;

                        try {
                            xactCallback(xact);
                        } catch (exception) {
                            log(ERROR, xactType + ": exception " + exception.message);
                            _rejectError(dfd, xactType + " callback threw an exception", { exception: exception });
                            log(DEBUG, xactType + ": rejected");
                        }
                    },
                    function (sqlError) {
                        log(ERROR, xactType + ": error " + sqlError);
                        _rejectError(dfd, "Failed executing " + xactType.replace(/transaction/i, "") + " transaction", { sqlError: sqlError });
                        log(DEBUG, xactType + ": rejected");
                    },
                    function () {
                        log(DEBUG, xactType + ": resolving");

                        if (called) {
                            if (inProgressBatchXact && !isEmptyObject(batchSqlCache)) {
                                _rejectError(dfd, "Transaction completed without executing all statements.", { errorCode: errorCodes.skippedStatements });
                            } else {
                                dfd.resolve(this);

                                log(DEBUG, xactType + ": resolved");
                            }
                        } else {
                            _rejectError(dfd, "Transaction callback was skipped.", { errorCode: errorCodes.skippedCallback });
                        }
                    });
                }
            } catch (exception) {
                log(ERROR, xactType + ": exception " + exception);
                _rejectError(dfd, "Failed calling " + xactType, { exception: exception });
                log(DEBUG, xactType + ": rejected");
            }
            log(DEBUG, xactType + ": out");
            return promise(dfd);
        }

        // #### isEmptyObject()
        //
        // Returns true if the object has no enumerable own-properties
        //
        function isEmptyObject(obj) {
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) {
                    return false;
                }
            }

            return true;
        }

        // #### execSqlStatements(xactMethod, sqlStatement, args, rsCallback)
        //
        // Execute sqlStatement in the context of `xactMethod`
        //
        // Implements common behavior for `wsdb.execute` and `wsdb.read`
        //
        function execSqlStatements(xactMethod, sqlStatement, args, rsCallback) {
            var results = [];
            if (typeof (args) === "function") {
                rsCallback = args;
                args = undefined;
            }

            var sqlStatementCount;
            var isArray;
            var executionPromise = inProgressBatchXact ? executeStatementsInCurrentXact() : executeStatementsInNewXact();

            return pipe(executionPromise, function () {
                return isArray ? results : results[0];
            }, function (err) {
                err.sql = sqlStatement;
                return _rejectError(defer(), err);
            });

            function executeStatementsInNewXact() {
                return xactMethod(function (xact) {
                    executeStatementsInXact(xact, cmndCallback);
                });

                function cmndCallback(xact, sql, args) {
	                traceExecuteSql(sql, args);
                    xact.executeSql(sql, args || [], function (xact, rs) {
                        results.push(rsCallback ? rsCallback(rs) : rs);
                    });
                }
            }

            function executeStatementsInCurrentXact() {
                var sqlStatementsExecuted = 0;

                var dfd = defer();
                executeStatementsInXact(inProgressBatchXact, cmndCallback);

                return promise(dfd);

                function cmndCallback(xact, sql, args) {
                    var id = getBatchUniqueSqlId();

                    batchSqlCache[id] = true;
	                traceExecuteSql(sql, args);
                    xact.executeSql(sql, args || [], function (xact, rs) {
                        delete batchSqlCache[id];

                        results.push(rsCallback ? rsCallback(rs) : rs);

                        sqlStatementsExecuted++;

                        if (sqlStatementsExecuted == sqlStatementCount) {
                            dfd.resolve();
                        }
                    }, function rejectWithError(xact, error) {
                        delete batchSqlCache[id];

                        dfd.reject(error);
                    });
                }
            }

            function executeStatementsInXact(xact, cmndCallback) {
                var i;
                if (_isArray(sqlStatement)) {
                    isArray = true;
                    sqlStatementCount = sqlStatement.length;

                    for (i = 0; i < sqlStatement.length; i++) {
                        var cmnd = sqlStatement[i];
                        var params = _isUndefined(cmnd.args) ? args : cmnd.args;
                        cmndCallback(xact, _isString(cmnd) ? cmnd : cmnd.sql, params);
                    }
                } else {
                    isArray = _isArray(args) && _isArray(args[0]);
                    var argSets = isArray ? args : [args];
                    sqlStatementCount = argSets.length;

                    for (i = 0; i < argSets.length; i++) {
                        cmndCallback(xact, sqlStatement, argSets[i]);
                    }
                }
            }
        }

        // #### transactionBatch(callback)
        //
        // Method for executing all db operations executed by a `callback`, within a single transaction.
        // The `callback` must return a promise that resolves when all db operations are complete,
        // and it must not execute asynchronous operations other than those against the db.
        //
        // If the `callback` returns a promise that rejects, then the current transaction will be aborted.
        //
        // Usage:
        //
        //      wsdb.transactionBatch(function() {
        //          return wsdb.execute([{
        //                  sql: 'CREATE TABLE IF NOT EXISTS test (id INTEGER, name, value)',
        //              }])
        //              .then(function() {
        //                  return wsdb.execute("INSERT INTO test (name, value) VALUES ('foo', 'FOO')");
        //              })
        //              .then(function() {
        //                  return wsdb.execute("INSERT INTO test (name, value) VALUES ('bar', 'BAR')");
        //              });
        //      });
        //
        var batchSqlCache = { };

        var batchUniqueSqlId = 0;

        function getBatchUniqueSqlId() {
            return ++batchUniqueSqlId;
        }

        function transactionBatch(callback) {

            if (!_isFunction(callback))
            {
                return _rejectError(defer(), new Error("No transaction batch callback was specified"));
            }

            if (inProgressBatchXact) {
                return _rejectError(defer(), new Error("A transaction batch is already in progress"));
            }

            return executeXact();

            function executeXact() {
                var dfd = defer();
                var callbackError;

                var xactPromise = transaction(function (xact) {
                    inProgressBatchXact = xact;

                    pipe(callback(), null, abortXact);

                    function abortXact(error) {
	                    traceExecuteSql("Abort!");
                        xact.executeSql("Abort!", null, null, function () {
                            callbackError = error;

                            return true;
                        });
                    }
                });

                pipe(xactPromise, clearInProgressXact, clearInProgressXact);

                pipe(xactPromise, function () {
                        dfd.resolve();
                    }, function (error) {
                        _rejectError(dfd, callbackError || error);
                    });

                return promise(dfd);
            }

            function clearInProgressXact() {
                inProgressBatchXact = undefined;
                batchSqlCache = { };
                batchUniqueSqlId = 0;
            }
        }

        var exports = {
            openDatabase: openDatabase,

            changeVersion: changeVersion,
            getTables: getTables,
            tableExists: tableExists,
            destroyDatabase: destroyDatabase,

            transaction: transaction,
            transactionBatch: transactionBatch,
            readTransaction: readTransaction,

            execute: execute,
            read: read,
            readRow: readRow
        };

        Object.defineProperties(exports, {
            // #### isTransactionBatchInProgress
            //
            // Returns true if a transactionBatch is currently in progress
            //
            isTransactionBatchInProgress: {
                get: function () {
                    return !!inProgressBatchXact;
                }
            },

            // #### inProgressBatchTransaction
            //
            // Returns the SQLTransaction that is currently in progress
            //
            inProgressBatchTransaction: {
                get: function () {
                    if (inProgressBatchXact) {
                        return new XactWrapper(inProgressBatchXact);
                    }
                }
            },

	        // #### queryCount
	        //
	        // Returns the number of queries executed against this database
	        //
	        queryCount: {
		        get: function() {
			        return queryCount;
		        }
	        }
        });

        // Initialize db from native Database or by opening `name`
        if (_isDatabase(name)) {
            exports.db = db = name;
            var dfd = defer();
            exports.promise = promise(dfd);
            dfd.resolve(this);
        } else if (name) {
            openDatabase(name, _version_, _displayName_, _estimatedSize_);
        }

        // Wraps a native SQLTransaction object so that we can
        // keep track of the number of statements that have been queued up
        // as part of the current transaction batch
        var XactWrapper = function (xact) {

            this.executeSql = function (sql, args, successCallback, errorCallback) {
                var id = getBatchUniqueSqlId();

                batchSqlCache[id] = true;
	            traceExecuteSql(sql, args);
                xact.executeSql(sql, args, function () {
                    delete batchSqlCache[id];

                    if (successCallback) {
                        successCallback.apply(this, arguments);
                    }
                }, function () {
                    delete batchSqlCache[id];

                    if (errorCallback) {
                        errorCallback.apply(this, arguments);
                    }
                });
            };
        };

        return exports;
    }

    // Internal Functions
    // ------------------

    // #### defer()
    //
    // Create a deferred object
    //
    var defer = function () {
        throw new Error("websql.defer not configured");
    };

    // #### promise(deferred)
    //
    // Returns the promise from a deferred object
    //
    var promise = function (dfd) {
        return _isFunction(dfd.pipe) ? dfd.promise() : dfd.promise;
    };

    // #### pipe(promise, onSuccess, onError)
    //
    // Calls `onSuccess` or `onError` when `promise` is resolved.
    //
    // Returns a new promise that is resolved/rejected based on the
    // values returned from the callbacks.
    //
    var pipe = function (p, onSuccess, onError) {
        var dfd = defer();
        p.then(function (val) {
            if (onSuccess) {
                val = onSuccess(val);
            }
            if (_isPromise(val)) {
                val.then(dfd.resolve, dfd.reject);
            } else {
                dfd.resolve(val);
            }

        }, function (err) {
            if (onError) {
                err = onError(err);
            }
            if (_isPromise(err)) {
                err.then(dfd.resolve, dfd.reject);
            } else {
                dfd.reject(err);
            }
        });
        return promise(dfd);
    };

    // #### log(level, msg1, msg2, ...)
    //
    // Log statement unless level > verbosity
    //
    // Usage:
    //
    //      log(DEBUG, "Calling function", functionName);
    //      log(ERROR, "Something horrible happened:", error);
    //
    function log(level) {
        if (level <= verbosity && trace) {
            var args = Array.prototype.slice.call(arguments, 1);
            args.unshift("WebSQL:");
            if (_isFunction(trace.text)) {
                trace.text(args, "color: purple");
            } else if (_isFunction(trace.log)) {
                trace.log(args.join(' '));
            }
        }
    }

    function setConsole(console) {
        trace = console;
    }

    function _rejectError(dfd, error, options) {
        if (_isString(error)) {
            error = new Error(error);
        }

        if (options) {
            if (options.exception) {
                error.exception = options.exception;
            }

            if (options.sqlError) {
                error.sqlError = options.sqlError;
            }

            if (options.errorCode) {
                error.errorCode = options.errorCode;
            }
        }

        log(ERROR, "ERROR: " + error.message || error.exception || error.sqlError);
        dfd.reject(error);
        return promise(dfd);
    }

    function _toString(obj) {
        return Object.prototype.toString.call(obj);
    }

    function _isString(fn) {
        return _toString(fn) === '[object String]';
    }

    function _isDatabase(db) {
        return _toString(db) === '[object Database]' || db.isDatabase;
    }

    function _isFunction(fn) {
        return _toString(fn) === '[object Function]';
    }

    function _isUndefined(obj) {
        return obj === void 0;
    }

    function _isPromise(obj) {
        return obj && _isFunction(obj.then);
    }

    var _isArray;

    _isArray = Array.isArray || function (obj) {
        return _toString(obj) === '[object Array]';
    };

    // ### ctor function()
    //
    function websql(name, version, displayName, estimatedSize) {
        return new WebsqlDatabase(name, version, displayName, estimatedSize);
    }

    // ### websql.config(settings) ###
    //
    // Sets `websql` configuration:
    //
    // * `defer`: specifies the function that constructs a deferred object.
    // Default is window.when, window.Q or window.jQuery.Deferred, if present.
    // * `trace`: specifies the object used for logging messages. Default is `window.console`.
    // * `logVerbosity`: specifies verbosity of logging (NONDE, ERROR or DEBUG). Default is `websql.log.NONE`.
    //
    websql.config = function (settings) {
	    if(settings) {
		    if (_isFunction(settings.defer)) {
			    defer = settings.defer;
		    }
		    if (_isFunction(settings.trace)) {
			    trace = settings.trace;
		    }
		    if(!_isUndefined(settings.traceDb)) {
			    traceDb = settings.traceDb
		    }
		    if (!_isUndefined(settings.logVerbosity)) {
			    verbosity = settings.logVerbosity;
		    }
	    }
	    
	    return {
		    defer: defer,
		    trace: trace,
		    traceDb: traceDb,
		    logVerbosity: verbosity
	    };
    };

	// #### queryCount
	//
	// Returns the number of queries executed against all databases
	//
	websql.queryCount = function() {
		return globalQueryCount;
	};

    // ### websql.log ###
    //
    // Predefined `logVerbosity` levels:
    //
    // * `websql.log.NONE`: No logging.
    // * `websql.log.ERROR`: Log errors.
    // * `websql.log.DEBUG`: Verbose logging.
    //
    websql.log = {
        NONE: NONE,
        ERROR: ERROR,
        DEBUG: DEBUG
    };

    // Try to initialize defer() function based on window globals
    if (window.when && _isFunction(window.when.defer)) {
        // https://github.com/cujojs/when
        defer = window.when.defer;
    } else if (window.Q && _isFunction(window.Q.defer)) {
        // https://github.com/kriskowal/q
        defer = window.Q.defer;
    } else if (window.jQuery && _isFunction(window.jQuery.Deferred)) {
        // http://jquery.com
        defer = window.jQuery.Deferred;
    }

    var errorCodes = {
        // * `websql.errorCodes.skippedCallback`: Error used when the transaction callback is skipped.
        skippedCallback: 'skippedCallback',

         // * `websql.errorCodes.skippedStatements`: Error used when the transaction completes
         // without executing all of the transaction statements
        skippedStatements: 'skippedStatements'
    };

    websql.errorCodes = errorCodes;

    websql._internal = {
        pipe: pipe,
        promise: promise
    };

    Object.defineProperties(websql._internal, {
        defer: {
            get: function () {
                return defer;
            }
        },
        // Used during testing to simulate the opening of
        // the first database
        isFirstOpenDatabaseRequest: {
            get: function() {
                return isFirstOpenDatabaseRequest;
            },
            set: function(value) {
                isFirstOpenDatabaseRequest = value;
            }
        },
        hasDbSizeIncreaseBug: {
            get: function() {
                return hasDbSizeIncreaseBug;
            },
            set: function(value) {
                hasDbSizeIncreaseBug = value;
            }
        }
    });

    return websql;
}));
/** @license MIT License (c) copyright 2011-2013 original author or authors */

/**
 * A lightweight CommonJS Promises/A and when() implementation
 * when is part of the cujo.js family of libraries (http://cujojs.com/)
 *
 * Licensed under the MIT License at:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * @author Brian Cavalier
 * @author John Hann
 *
 * @version 1.8.1
 */

(function(define) { 'use strict';
	define('lib/when',[],function () {
		var reduceArray, slice, undef;

		//
		// Public API
		//

		when.defer     = defer;     // Create a deferred
		when.resolve   = resolve;   // Create a resolved promise
		when.reject    = reject;    // Create a rejected promise

		when.join      = join;      // Join 2 or more promises

		when.all       = all;       // Resolve a list of promises
		when.map       = map;       // Array.map() for promises
		when.reduce    = reduce;    // Array.reduce() for promises

		when.any       = any;       // One-winner race
		when.some      = some;      // Multi-winner race

		when.chain     = chain;     // Make a promise trigger another resolver

		when.isPromise = isPromise; // Determine if a thing is a promise

		/**
		 * Register an observer for a promise or immediate value.
		 *
		 * @param {*} promiseOrValue
		 * @param {function?} [onFulfilled] callback to be called when promiseOrValue is
		 *   successfully fulfilled.  If promiseOrValue is an immediate value, callback
		 *   will be invoked immediately.
		 * @param {function?} [onRejected] callback to be called when promiseOrValue is
		 *   rejected.
		 * @param {function?} [onProgress] callback to be called when progress updates
		 *   are issued for promiseOrValue.
		 * @returns {Promise} a new {@link Promise} that will complete with the return
		 *   value of callback or errback or the completion value of promiseOrValue if
		 *   callback and/or errback is not supplied.
		 */
		function when(promiseOrValue, onFulfilled, onRejected, onProgress) {
			// Get a trusted promise for the input promiseOrValue, and then
			// register promise handlers
			return resolve(promiseOrValue).then(onFulfilled, onRejected, onProgress);
		}

		/**
		 * Returns promiseOrValue if promiseOrValue is a {@link Promise}, a new Promise if
		 * promiseOrValue is a foreign promise, or a new, already-fulfilled {@link Promise}
		 * whose value is promiseOrValue if promiseOrValue is an immediate value.
		 *
		 * @param {*} promiseOrValue
		 * @returns {Promise} Guaranteed to return a trusted Promise.  If promiseOrValue
		 *   is trusted, returns promiseOrValue, otherwise, returns a new, already-resolved
		 *   when.js promise whose resolution value is:
		 *   * the resolution value of promiseOrValue if it's a foreign promise, or
		 *   * promiseOrValue if it's a value
		 */
		function resolve(promiseOrValue) {
			var promise;

			if(promiseOrValue instanceof Promise) {
				// It's a when.js promise, so we trust it
				promise = promiseOrValue;

			} else if(isPromise(promiseOrValue)) {
				// Assimilate foreign promises
				promise = assimilate(promiseOrValue);
			} else {
				// It's a value, create a fulfilled promise for it.
				promise = fulfilled(promiseOrValue);
			}

			return promise;
		}

		/**
		 * Assimilate an untrusted thenable by introducing a trusted middle man.
		 * Not a perfect strategy, but possibly the best we can do.
		 * IMPORTANT: This is the only place when.js should ever call an untrusted
		 * thenable's then() on an. Don't expose the return value to the untrusted thenable
		 *
		 * @param {*} thenable
		 * @param {function} thenable.then
		 * @returns {Promise}
		 */
		function assimilate(thenable) {
			var d = defer();

			// TODO: Enqueue this for future execution in 2.0
			try {
				thenable.then(
					function(value)  { d.resolve(value); },
					function(reason) { d.reject(reason); },
					function(update) { d.progress(update); }
				);
			} catch(e) {
				d.reject(e);
			}

			return d.promise;
		}

		/**
		 * Returns a rejected promise for the supplied promiseOrValue.  The returned
		 * promise will be rejected with:
		 * - promiseOrValue, if it is a value, or
		 * - if promiseOrValue is a promise
		 *   - promiseOrValue's value after it is fulfilled
		 *   - promiseOrValue's reason after it is rejected
		 * @param {*} promiseOrValue the rejected value of the returned {@link Promise}
		 * @return {Promise} rejected {@link Promise}
		 */
		function reject(promiseOrValue) {
			return when(promiseOrValue, rejected);
		}

		/**
		 * Trusted Promise constructor.  A Promise created from this constructor is
		 * a trusted when.js promise.  Any other duck-typed promise is considered
		 * untrusted.
		 * @constructor
		 * @name Promise
		 */
		function Promise(then) {
			this.then = then;
		}

		Promise.prototype = {
			/**
			 * Register a callback that will be called when a promise is
			 * fulfilled or rejected.  Optionally also register a progress handler.
			 * Shortcut for .then(onFulfilledOrRejected, onFulfilledOrRejected, onProgress)
			 * @param {function?} [onFulfilledOrRejected]
			 * @param {function?} [onProgress]
			 * @return {Promise}
			 */
			always: function(onFulfilledOrRejected, onProgress) {
				return this.then(onFulfilledOrRejected, onFulfilledOrRejected, onProgress);
			},

			/**
			 * Register a rejection handler.  Shortcut for .then(undefined, onRejected)
			 * @param {function?} onRejected
			 * @return {Promise}
			 */
			otherwise: function(onRejected) {
				return this.then(undef, onRejected);
			},

			/**
			 * Shortcut for .then(function() { return value; })
			 * @param  {*} value
			 * @return {Promise} a promise that:
			 *  - is fulfilled if value is not a promise, or
			 *  - if value is a promise, will fulfill with its value, or reject
			 *    with its reason.
			 */
			'yield': function(value) {
				return this.then(function() {
					return value;
				});
			},

			/**
			 * Assumes that this promise will fulfill with an array, and arranges
			 * for the onFulfilled to be called with the array as its argument list
			 * i.e. onFulfilled.apply(undefined, array).
			 * @param {function} onFulfilled function to receive spread arguments
			 * @return {Promise}
			 */
			spread: function(onFulfilled) {
				return this.then(function(array) {
					// array may contain promises, so resolve its contents.
					return all(array, function(array) {
						return onFulfilled.apply(undef, array);
					});
				});
			}
		};

		/**
		 * Create an already-resolved promise for the supplied value
		 * @private
		 *
		 * @param {*} value
		 * @return {Promise} fulfilled promise
		 */
		function fulfilled(value) {
			var p = new Promise(function(onFulfilled) {
				try {
					return resolve(typeof onFulfilled == 'function' ? onFulfilled(value) : value);
				} catch(e) {
					return rejected(e);
				}
			});

			return p;
		}

		/**
		 * Create an already-rejected {@link Promise} with the supplied
		 * rejection reason.
		 * @private
		 *
		 * @param {*} reason
		 * @return {Promise} rejected promise
		 */
		function rejected(reason) {
			var p = new Promise(function(_, onRejected) {
				try {
					return resolve(typeof onRejected == 'function' ? onRejected(reason) : rejected(reason));
				} catch(e) {
					return rejected(e);
				}
			});

			return p;
		}

		/**
		 * Creates a new, Deferred with fully isolated resolver and promise parts,
		 * either or both of which may be given out safely to consumers.
		 * The Deferred itself has the full API: resolve, reject, progress, and
		 * then. The resolver has resolve, reject, and progress.  The promise
		 * only has then.
		 *
		 * @return {Deferred}
		 */
		function defer() {
			var deferred, promise, handlers, progressHandlers,
				_then, _notify, _resolve;

			/**
			 * The promise for the new deferred
			 * @type {Promise}
			 */
			promise = new Promise(then);

			/**
			 * The full Deferred object, with {@link Promise} and {@link Resolver} parts
			 * @class Deferred
			 * @name Deferred
			 */
			deferred = {
				then:     then, // DEPRECATED: use deferred.promise.then
				resolve:  promiseResolve,
				reject:   promiseReject,
				progress: promiseNotify, // DEPRECATED: use deferred.notify
				notify:   promiseNotify,

				promise:  promise,

				resolver: {
					resolve:  promiseResolve,
					reject:   promiseReject,
					progress: promiseNotify, // DEPRECATED: use deferred.notify
					notify:   promiseNotify
				}
			};

			handlers = [];
			progressHandlers = [];

			/**
			 * Pre-resolution then() that adds the supplied callback, errback, and progback
			 * functions to the registered listeners
			 * @private
			 *
			 * @param {function?} [onFulfilled] resolution handler
			 * @param {function?} [onRejected] rejection handler
			 * @param {function?} [onProgress] progress handler
			 */
			_then = function(onFulfilled, onRejected, onProgress) {
				var deferred, progressHandler;

				deferred = defer();

				progressHandler = typeof onProgress === 'function'
					? function(update) {
					try {
						// Allow progress handler to transform progress event
						deferred.notify(onProgress(update));
					} catch(e) {
						// Use caught value as progress
						deferred.notify(e);
					}
				}
					: function(update) { deferred.notify(update); };

				handlers.push(function(promise) {
					promise.then(onFulfilled, onRejected)
						.then(deferred.resolve, deferred.reject, progressHandler);
				});

				progressHandlers.push(progressHandler);

				return deferred.promise;
			};

			/**
			 * Issue a progress event, notifying all progress listeners
			 * @private
			 * @param {*} update progress event payload to pass to all listeners
			 */
			_notify = function(update) {
				processQueue(progressHandlers, update);
				return update;
			};

			/**
			 * Transition from pre-resolution state to post-resolution state, notifying
			 * all listeners of the resolution or rejection
			 * @private
			 * @param {*} value the value of this deferred
			 */
			_resolve = function(value) {
				// Replace _then with one that directly notifies with the result.
				_then = value.then;
				// Replace _resolve so that this Deferred can only be resolved once
				_resolve = resolve;
				// Make _progress a noop, to disallow progress for the resolved promise.
				_notify = identity;

				// Notify handlers
				processQueue(handlers, value);

				// Free progressHandlers array since we'll never issue progress events
				progressHandlers = handlers = undef;

				return value;
			};

			return deferred;

			/**
			 * Wrapper to allow _then to be replaced safely
			 * @param {function?} [onFulfilled] resolution handler
			 * @param {function?} [onRejected] rejection handler
			 * @param {function?} [onProgress] progress handler
			 * @return {Promise} new promise
			 */
			function then(onFulfilled, onRejected, onProgress) {
				// TODO: Promises/A+ check typeof onFulfilled, onRejected, onProgress
				return _then(onFulfilled, onRejected, onProgress);
			}

			/**
			 * Wrapper to allow _resolve to be replaced
			 */
			function promiseResolve(val) {
				return _resolve(resolve(val));
			}

			/**
			 * Wrapper to allow _reject to be replaced
			 */
			function promiseReject(err) {
				return _resolve(rejected(err));
			}

			/**
			 * Wrapper to allow _notify to be replaced
			 */
			function promiseNotify(update) {
				return _notify(update);
			}
		}

		/**
		 * Determines if promiseOrValue is a promise or not.  Uses the feature
		 * test from http://wiki.commonjs.org/wiki/Promises/A to determine if
		 * promiseOrValue is a promise.
		 *
		 * @param {*} promiseOrValue anything
		 * @returns {boolean} true if promiseOrValue is a {@link Promise}
		 */
		function isPromise(promiseOrValue) {
			return promiseOrValue && typeof promiseOrValue.then === 'function';
		}

		/**
		 * Initiates a competitive race, returning a promise that will resolve when
		 * howMany of the supplied promisesOrValues have resolved, or will reject when
		 * it becomes impossible for howMany to resolve, for example, when
		 * (promisesOrValues.length - howMany) + 1 input promises reject.
		 *
		 * @param {Array} promisesOrValues array of anything, may contain a mix
		 *      of promises and values
		 * @param howMany {number} number of promisesOrValues to resolve
		 * @param {function?} [onFulfilled] resolution handler
		 * @param {function?} [onRejected] rejection handler
		 * @param {function?} [onProgress] progress handler
		 * @returns {Promise} promise that will resolve to an array of howMany values that
		 * resolved first, or will reject with an array of (promisesOrValues.length - howMany) + 1
		 * rejection reasons.
		 */
		function some(promisesOrValues, howMany, onFulfilled, onRejected, onProgress) {

			checkCallbacks(2, arguments);

			return when(promisesOrValues, function(promisesOrValues) {

				var toResolve, toReject, values, reasons, deferred, fulfillOne, rejectOne, notify, len, i;

				len = promisesOrValues.length >>> 0;

				toResolve = Math.max(0, Math.min(howMany, len));
				values = [];

				toReject = (len - toResolve) + 1;
				reasons = [];

				deferred = defer();

				// No items in the input, resolve immediately
				if (!toResolve) {
					deferred.resolve(values);

				} else {
					notify = deferred.notify;

					rejectOne = function(reason) {
						reasons.push(reason);
						if(!--toReject) {
							fulfillOne = rejectOne = noop;
							deferred.reject(reasons);
						}
					};

					fulfillOne = function(val) {
						// This orders the values based on promise resolution order
						// Another strategy would be to use the original position of
						// the corresponding promise.
						values.push(val);

						if (!--toResolve) {
							fulfillOne = rejectOne = noop;
							deferred.resolve(values);
						}
					};

					for(i = 0; i < len; ++i) {
						if(i in promisesOrValues) {
							when(promisesOrValues[i], fulfiller, rejecter, notify);
						}
					}
				}

				return deferred.promise.then(onFulfilled, onRejected, onProgress);

				function rejecter(reason) {
					rejectOne(reason);
				}

				function fulfiller(val) {
					fulfillOne(val);
				}

			});
		}

		/**
		 * Initiates a competitive race, returning a promise that will resolve when
		 * any one of the supplied promisesOrValues has resolved or will reject when
		 * *all* promisesOrValues have rejected.
		 *
		 * @param {Array|Promise} promisesOrValues array of anything, may contain a mix
		 *      of {@link Promise}s and values
		 * @param {function?} [onFulfilled] resolution handler
		 * @param {function?} [onRejected] rejection handler
		 * @param {function?} [onProgress] progress handler
		 * @returns {Promise} promise that will resolve to the value that resolved first, or
		 * will reject with an array of all rejected inputs.
		 */
		function any(promisesOrValues, onFulfilled, onRejected, onProgress) {

			function unwrapSingleResult(val) {
				return onFulfilled ? onFulfilled(val[0]) : val[0];
			}

			return some(promisesOrValues, 1, unwrapSingleResult, onRejected, onProgress);
		}

		/**
		 * Return a promise that will resolve only once all the supplied promisesOrValues
		 * have resolved. The resolution value of the returned promise will be an array
		 * containing the resolution values of each of the promisesOrValues.
		 * @memberOf when
		 *
		 * @param {Array|Promise} promisesOrValues array of anything, may contain a mix
		 *      of {@link Promise}s and values
		 * @param {function?} [onFulfilled] resolution handler
		 * @param {function?} [onRejected] rejection handler
		 * @param {function?} [onProgress] progress handler
		 * @returns {Promise}
		 */
		function all(promisesOrValues, onFulfilled, onRejected, onProgress) {
			checkCallbacks(1, arguments);
			return map(promisesOrValues, identity).then(onFulfilled, onRejected, onProgress);
		}

		/**
		 * Joins multiple promises into a single returned promise.
		 * @return {Promise} a promise that will fulfill when *all* the input promises
		 * have fulfilled, or will reject when *any one* of the input promises rejects.
		 */
		function join(/* ...promises */) {
			return map(arguments, identity);
		}

		/**
		 * Traditional map function, similar to `Array.prototype.map()`, but allows
		 * input to contain {@link Promise}s and/or values, and mapFunc may return
		 * either a value or a {@link Promise}
		 *
		 * @param {Array|Promise} promise array of anything, may contain a mix
		 *      of {@link Promise}s and values
		 * @param {function} mapFunc mapping function mapFunc(value) which may return
		 *      either a {@link Promise} or value
		 * @returns {Promise} a {@link Promise} that will resolve to an array containing
		 *      the mapped output values.
		 */
		function map(promise, mapFunc) {
			return when(promise, function(array) {
				var results, len, toResolve, resolve, i, d;

				// Since we know the resulting length, we can preallocate the results
				// array to avoid array expansions.
				toResolve = len = array.length >>> 0;
				results = [];
				d = defer();

				if(!toResolve) {
					d.resolve(results);
				} else {

					resolve = function resolveOne(item, i) {
						when(item, mapFunc).then(function(mapped) {
							results[i] = mapped;

							if(!--toResolve) {
								d.resolve(results);
							}
						}, d.reject);
					};

					// Since mapFunc may be async, get all invocations of it into flight
					for(i = 0; i < len; i++) {
						if(i in array) {
							resolve(array[i], i);
						} else {
							--toResolve;
						}
					}

				}

				return d.promise;

			});
		}

		/**
		 * Traditional reduce function, similar to `Array.prototype.reduce()`, but
		 * input may contain promises and/or values, and reduceFunc
		 * may return either a value or a promise, *and* initialValue may
		 * be a promise for the starting value.
		 *
		 * @param {Array|Promise} promise array or promise for an array of anything,
		 *      may contain a mix of promises and values.
		 * @param {function} reduceFunc reduce function reduce(currentValue, nextValue, index, total),
		 *      where total is the total number of items being reduced, and will be the same
		 *      in each call to reduceFunc.
		 * @returns {Promise} that will resolve to the final reduced value
		 */
		function reduce(promise, reduceFunc /*, initialValue */) {
			var args = slice.call(arguments, 1);

			return when(promise, function(array) {
				var total;

				total = array.length;

				// Wrap the supplied reduceFunc with one that handles promises and then
				// delegates to the supplied.
				args[0] = function (current, val, i) {
					return when(current, function (c) {
						return when(val, function (value) {
							return reduceFunc(c, value, i, total);
						});
					});
				};

				return reduceArray.apply(array, args);
			});
		}

		/**
		 * Ensure that resolution of promiseOrValue will trigger resolver with the
		 * value or reason of promiseOrValue, or instead with resolveValue if it is provided.
		 *
		 * @param promiseOrValue
		 * @param {Object} resolver
		 * @param {function} resolver.resolve
		 * @param {function} resolver.reject
		 * @param {*} [resolveValue]
		 * @returns {Promise}
		 */
		function chain(promiseOrValue, resolver, resolveValue) {
			var useResolveValue = arguments.length > 2;

			return when(promiseOrValue,
				function(val) {
					val = useResolveValue ? resolveValue : val;
					resolver.resolve(val);
					return val;
				},
				function(reason) {
					resolver.reject(reason);
					return rejected(reason);
				},
				function(update) {
					typeof resolver.notify === 'function' && resolver.notify(update);
					return update;
				}
			);
		}

		//
		// Utility functions
		//

		/**
		 * Apply all functions in queue to value
		 * @param {Array} queue array of functions to execute
		 * @param {*} value argument passed to each function
		 */
		function processQueue(queue, value) {
			var handler, i = 0;

			while (handler = queue[i++]) {
				handler(value);
			}
		}

		/**
		 * Helper that checks arrayOfCallbacks to ensure that each element is either
		 * a function, or null or undefined.
		 * @private
		 * @param {number} start index at which to start checking items in arrayOfCallbacks
		 * @param {Array} arrayOfCallbacks array to check
		 * @throws {Error} if any element of arrayOfCallbacks is something other than
		 * a functions, null, or undefined.
		 */
		function checkCallbacks(start, arrayOfCallbacks) {
			// TODO: Promises/A+ update type checking and docs
			var arg, i = arrayOfCallbacks.length;

			while(i > start) {
				arg = arrayOfCallbacks[--i];

				if (arg != null && typeof arg != 'function') {
					throw new Error('arg '+i+' must be a function');
				}
			}
		}

		/**
		 * No-Op function used in method replacement
		 * @private
		 */
		function noop() {}

		slice = [].slice;

		// ES5 reduce implementation if native not available
		// See: http://es5.github.com/#x15.4.4.21 as there are many
		// specifics and edge cases.
		reduceArray = [].reduce ||
			function(reduceFunc /*, initialValue */) {
				/*jshint maxcomplexity: 7*/

				// ES5 dictates that reduce.length === 1

				// This implementation deviates from ES5 spec in the following ways:
				// 1. It does not check if reduceFunc is a Callable

				var arr, args, reduced, len, i;

				i = 0;
				// This generates a jshint warning, despite being valid
				// "Missing 'new' prefix when invoking a constructor."
				// See https://github.com/jshint/jshint/issues/392
				arr = Object(this);
				len = arr.length >>> 0;
				args = arguments;

				// If no initialValue, use first item of array (we know length !== 0 here)
				// and adjust i to start at second item
				if(args.length <= 1) {
					// Skip to the first real element in the array
					for(;;) {
						if(i in arr) {
							reduced = arr[i++];
							break;
						}

						// If we reached the end of the array without finding any real
						// elements, it's a TypeError
						if(++i >= len) {
							throw new TypeError();
						}
					}
				} else {
					// If initialValue provided, use it
					reduced = args[1];
				}

				// Do the actual reduce
				for(;i < len; ++i) {
					// Skip holes
					if(i in arr) {
						reduced = reduceFunc(reduced, arr[i], i, arr);
					}
				}

				return reduced;
			};

		function identity(x) {
			return x;
		}

		return when;
	});
})(typeof define == 'function' && define.amd
		? define
		: function (factory) { typeof exports === 'object'
		? (module.exports = factory())
		: (this.when      = factory());
	}
		// Boilerplate for AMD, Node, and browser global
	);
/** @license MIT License (c) copyright 2013 original author or authors */

/**
 * callbacks.js
 *
 * Collection of helper functions for interacting with 'traditional',
 * callback-taking functions using a promise interface.
 *
 * @author Renato Zannon <renato.riccieri@gmail.com>
 */

(function(define) {
define('lib/callbacks',['./when'], function(when) {
	var slice = [].slice;

	return {
		apply:     apply,
		call:      call,
		bind:      bind,
		promisify: promisify
	};

	/**
	* Takes a `traditional` callback-taking function and returns a promise for its
	* result, accepting an optional array of arguments (that might be values or
	* promises). It assumes that the function takes its callback and errback as
	* the last two arguments. The resolution of the promise depends on whether the
	* function will call its callback or its errback.
	*
	* @example
	*	var domIsLoaded = callbacks.apply($);
	*	domIsLoaded.then(function() {
	*		doMyDomStuff();
	*	});
	*
	* @example
	*	function existingAjaxyFunction(url, callback, errback) {
	*		// Complex logic you'd rather not change
	*	}
	*
	*	var promise = callbacks.apply(existingAjaxyFunction, ["/movies.json"]);
	*
	*	promise.then(function(movies) {
	*		// Work with movies
	*	}, function(reason) {
	*		// Handle error
	*	});
	*
	* @param {function} asyncFunction function to be called
	* @param {Array} [extraAsyncArgs] array of arguments to asyncFunction
	* @returns {Promise} promise for the callback value of asyncFunction
	*/

	function apply(asyncFunction, extraAsyncArgs) {
		return when.all(extraAsyncArgs || []).then(function(args) {
			var deferred = when.defer();

			var asyncArgs = args.concat(
				alwaysUnary(deferred.resolve),
				alwaysUnary(deferred.reject)
			);

			asyncFunction.apply(null, asyncArgs);

			return deferred.promise;
		});
	}

	/**
	* Works as `callbacks.apply` does, with the difference that the arguments to
	* the function are passed individually, instead of as an array.
	*
	* @example
	*	function sumInFiveSeconds(a, b, callback) {
	*		setTimeout(function() {
	*			callback(a + b);
	*		}, 5000);
	*	}
	*
	*	var sumPromise = callbacks.call(sumInFiveSeconds, 5, 10);
	*
	*	// Logs '15' 5 seconds later
	*	sumPromise.then(console.log);
	*
	* @param {function} asyncFunction function to be called
	* @param {...*} [args] arguments that will be forwarded to the function
	* @returns {Promise} promise for the callback value of asyncFunction
	*/

	function call(asyncFunction/*, arg1, arg2...*/) {
		var extraAsyncArgs = slice.call(arguments, 1);
		return apply(asyncFunction, extraAsyncArgs);
	}

	/**
	* Takes a 'traditional' callback/errback-taking function and returns a function
	* that returns a promise instead. The resolution/rejection of the promise
	* depends on whether the original function will call its callback or its
	* errback.
	*
	* If additional arguments are passed to the `bind` call, they will be prepended
	* on the calls to the original function, much like `Function.prototype.bind`.
	*
	* The resulting function is also "promise-aware", in the sense that, if given
	* promises as arguments, it will wait for their resolution before executing.
	*
	* @example
	*	function traditionalAjax(method, url, callback, errback) {
	*		var xhr = new XMLHttpRequest();
	*		xhr.open(method, url);
	*
	*		xhr.onload = callback;
	*		xhr.onerror = errback;
	*
	*		xhr.send();
	*	}
	*
	*	var promiseAjax = callbacks.bind(traditionalAjax);
	*	promiseAjax("GET", "/movies.json").then(console.log, console.error);
	*
	*	var promiseAjaxGet = callbacks.bind(traditionalAjax, "GET");
	*	promiseAjaxGet("/movies.json").then(console.log, console.error);
	*
	* @param {Function} asyncFunction traditional function to be decorated
	* @param {...*} [args] arguments to be prepended for the new function
	* @returns {Function} a promise-returning function
	*/
	function bind(asyncFunction/*, args...*/) {
		var leadingArgs = slice.call(arguments, 1);

		return function() {
			var trailingArgs = slice.call(arguments, 0);
			return apply(asyncFunction, leadingArgs.concat(trailingArgs));
		};
	}

	/**
	* `promisify` is a version of `bind` that allows fine-grained control over the
	* arguments that passed to the underlying function. It is intended to handle
	* functions that don't follow the common callback and errback positions.
	*
	* The control is done by passing an object whose 'callback' and/or 'errback'
	* keys, whose values are the corresponding 0-based indexes of the arguments on
	* the function. Negative values are interpreted as being relative to the end
	* of the arguments array.
	*
	* If arguments are given on the call to the 'promisified' function, they are
	* intermingled with the callback and errback. If a promise is given among them,
	* the execution of the function will only occur after its resolution.
	*
	* @example
	*	var delay = callbacks.promisify(setTimeout, {
	*		callback: 0
	*	});
	*
	*	delay(100).then(function() {
	*		console.log("This happens 100ms afterwards");
	*	});
	*
	* @example
	*	function callbackAsLast(errback, followsStandards, callback) {
	*		if(followsStandards) {
	*			callback("well done!");
	*		} else {
	*			errback("some programmers just want to watch the world burn");
	*		}
	*	}
	*
	*	var promisified = callbacks.promisify(callbackAsLast, {
	*		callback: -1,
	*		errback:   0,
	*	});
	*
	*	promisified(true).then(console.log, console.error);
	*	promisified(false).then(console.log, console.error);
	*
	*/
	function promisify(asyncFunction, positions) {
		return function() {
			var finalArgs = fillableArray();
			var deferred = when.defer();

			if('callback' in positions) {
				finalArgs.add(positions.callback, alwaysUnary(deferred.resolve));
			}

			if('errback' in positions) {
				finalArgs.add(positions.errback, alwaysUnary(deferred.reject));
			}

			return when.all(arguments).then(function(args) {
				finalArgs.fillHolesWith(args);
				asyncFunction.apply(null, finalArgs.toArray());

				return deferred.promise;
			});
		};
	}

	function fillableArray() {
		var beginningArgs = [], endArgs = [];

		return {
			add: function(index, value) {
				if(index >= 0) {
					beginningArgs[index] = value;
				} else {
					// Since we can't know how many arguments at the end there'll be
					// (there might be -1, -2, -3...), we fill the array containing them
					// in reverse order: from the element that will be the last argument
					// (-1), following to the penultimate (-2) etc.
					var offsetFromEnd = Math.abs(index) - 1;
					endArgs[offsetFromEnd] = value;
				}
			},

			fillHolesWith: function(arrayLike) {
				var i, j;

				for(i = 0, j = 0; i < arrayLike.length; i++, j++) {
					while(j in beginningArgs) { j++; }
					beginningArgs[j] = arrayLike[i];
				}
			},

			toArray: function() {
				var result = slice.call(beginningArgs, 0);

				// Now, the 'endArgs' array is supposedly finished, and we can traverse
				// it to get the elements that should be appended to the array. Since
				// the elements are in reversed order, we traverse it from back to
				// front.
				for(var i = endArgs.length - 1; i >= 0; i--) {
					result.push(endArgs[i]);
				}

				return result;
			}
		};
	}

	function alwaysUnary(fn) {
		return function() {
			if(arguments.length <= 1) {
				fn.apply(null, arguments);
			} else {
				fn.call(null, slice.call(arguments, 0));
			}
		};
	}
});
})(typeof define == 'function'
	? define
	: function (deps, factory) { typeof module != 'undefined'
		? (module.exports = factory(require('./when')))
		: (this.when_callback = factory(this.when));
	}
	// Boilerplate for AMD, Node, and browser global
);

define('underscore',[],function() {
	"use strict";
	if(!_) {
		throw new Error("Missing '_' global variable.  Make sure underscore.js or lodash.js is included in your application.");
	}
	// Return _ variable
	return _;
});
define('Constants',[],
 function () {

	"use strict";

	/**
	 * @enum Constants.ConnectionEvent
	 *
	 * Events triggered by MDO.Connection. Exposed through `{@link MDO.Client#constants}.connectionEvents`.
	 *
	 * ## Usage:
	 *
	 *     mdoCon.on({@link MDO.Client#constants mdo.constants}.connectionEvents.{@link Constants.ConnectionEvent#dataAdded dataAdded}, function(mdoElt) {
	 *         alert("An MDO Element was added!");
	 *     });
	 *
	 */
	var connectionEvents = {
		/** data has been modified (inserted, updated, deleted, synced, etc.) */
		data: "data",

		/** new element is inserted */
		dataAdded: "data:added",

		/** element is updated */
		dataModified: "data:modified",

		/** element is deleted */
		dataDeleted: "data:deleted",

		/** datastore completes a "sync" with the server */
		dataSynced: "data:synced",

		/** datastore has been reset during a "sync" - existing unresolved (negative) PKeys are no longer valid */
		dataReset: "data:reset",

		/** model has been changed during a "sync" */
		modelChanged: "model:changed",

		/** the {@link MDO.Connection#sync} operation is preparing local transactions to be uploaded */
		syncPreparingUploadXacts: "sync:preparingUploadXacts",

		/** the {@link MDO.Connection#sync} operation is uploading local transactions */
		syncUploadingXacts: "sync:uploadingXacts",

		/** the {@link MDO.Connection#sync} operation has successfully uploaded local transactions */
		syncUploadedXacts: "sync:uploadedXacts",

		/** the {@link MDO.Connection#sync} operation is downloading transactions from server */
		syncDownloadingXacts: "sync:downloadingXacts",

		/** the {@link MDO.Connection#sync} operation has successfully downloaded transactions from server */
		syncDownloadedXacts: "sync:downloadedXacts",

		/** the {@link MDO.Connection#sync} operation is processing transactions from server */
		syncProcessingXacts: "sync:processingXacts",

		/** the {@link MDO.Connection#sync} operation is has successfully processed transactions from server */
		syncProcessedXacts: "sync:processedXacts"
	};

	/**
	 * @enum Constants.DataEvent
	 *
	 * Events triggered by MDO.FileElement.  Exposed through `{@link MDO.Client#constants}.dataEvents`.
	 *
	 * ## Usage:
	 *
	 *     mdoFileElt.on({@link MDO.Client#constants mdo.constants}.dataEvents.{@link Constants.DataEvent#fileSet fileSet}, function(file) {
	 *         alert("A file has been selected!");
	 *     });
	 *
	 */
	var dataEvents = {
		/** file was attached to the FileElement */
		fileSet: "file:set"
	};

	/** @enum Constants.ErrorCode
	 *
	 * Values in the `mdoCode` property on errors returned by MDO operations. Exposed through `{@link MDO.Client#constants}.errorCodes`.
	 *
	 * ## Usage:
	 *
	 *     mdoCon.sync().then(null, function(err) {
	 *         if(err.mdoCode == {@link MDO.Client#constants mdo.constants}.errorCodes.{@link Constants.ErrorCode#ajaxRequestTimeout ajaxRequestTimeout}) {
	 *             alert("Server connection timeout!");
	 *         }
	 *     });
	 */
	var errorCodes = {

		// ## Server errors (keep in sync with AtHand.DataSyncInterfaces.Json.Response.ErrorCode)

		/** Authentication failed due to invalid username or password */
		invalidCredentials: "InvalidCredentials",

		/** Credentials failed local authentication and device could not connect to server to verify */
		invalidLocalCredentials: "InvalidLocalCredentials",

		/** Request for posted files failed because a data repost is currently in progress */
		dataRepostInProgress: "DataRepostInProgress",

		/** Post failed because the authentication token provided was invalid */
		invalidSessionId: "InvalidSessionId",

		/** Query failed because filter provided was invalid */
		badFilter: "BadFilter",

		/** Query failed because there was no Data Access Component registered on the server */
		noDataAccessComponent: "NoDataAccessComponent",

		/** Query failed because it was rejected by the Data Access Component on the server */
		requestRejected: "RequestRejected",

		/** There was an error requesting device info from the server */
		registerDeviceRejected: "RegisterDeviceRejected",

		/** There was an error invoking the RPC on the server */
		deviceRpcRejected: "DeviceRpcRejected",

		// ## Client errors

		/**  Operation failed because the client does not possess an authentication token from the server. **/
		authTokenRequired: "AuthTokenRequired",

		/** Operation failed because an MDO.js prerequisite is not loaded */
		insufficientPrereqs: "InsufficientPrerequisites",

		/** Operation failed because the client is not installed */
		clientNotInstalled: "ClientNotInstalled",

		/** Operation failed because the device is not registered */
		deviceNotRegistered: "DeviceNotRegistered",

		/** Operation failed because it was canceled */
		canceled: "Canceled",

		/** Operation failed because no datastore has been installed */
		noDatastore: "NoDatastore",

		/** Element.resolve failed due to multiple matches */
		dataNotUnique: "DataNotUnique",

		/** Element.resolve failed due to no matches */
		dataNotFound: "DataNotFound",

		/** {@link MDO.Element#getElement Element.getElement} or {@link MDO.Element#fetchElement Element.fetchElement} failed because reference field was not fetched. */
		refFieldNotFetched: "RefFieldNotFetched",

		/** {@link MDO.Element#getElement Element.getElement} failed because merged references are not supported. */
		mergedRefNotSupported: "mergedRefNotSupported",

		/** The merged reference is invalid, usually because it references fields that are not fetched */
		invalidMergedReference: "invalidMergedReference",

		/** An attempt was made to reference a field or element that does not exist for the given class of this {@link MDO.Element} */
		unknownFieldOrElement: "unknownFieldOrElement",

		/** {@link MDO.FileElement#save FileElement.save} failed due to an existing {@link MDO.FileElement FileElement} with a matching ahFileName */
		fileNotUnique: "FileNotUnique",

		/** {@link MDO.FileElement#save FileElement.save} failed because no file name has been set */
		fileNameMissing: "FileNameMissing",

		/** {@link MDO.FileElement#getFileDataUrl FileElement.getFileDataUrl} failed because the element's attachment has not been downloaded from the server */
		fileNotDownloaded: "FileNotDownloaded",

		/** {@link MDO.FileElement#downloadFile FileElement.downloadFile} failed because its mdoState is `"new"` */
		fileElementIsNew: "FileElementIsNew",

		/** {@link MDO.FileElement#uploadFile FileElement.uploadFile} failed because attachment was not locally changed */
		fileElementNoChanges: "FileElementNoChanges",

		/** {@link MDO.FileElement#uploadFile FileElement.uploadFile} failed because `mdoState` is not `'saved'` */
		fileElementNotSaved: "FileElementNotSaved",

		/** Client.sync failed due to a sync already in progress **/
		syncInProgress: "SyncInProgress",

		/** Cannot connect to server **/
		offline: "Offline",

		/** Client.sync failed due to user interaction causing a transaction to be interrupted */
		uiInterruptedTransaction: "uiInterruptedTransaction",

		/** Client.sync failed due to user interaction causing a transaction to be skipped */
		uiSkippedTransaction: "uiSkippedTransaction",

		/** Ajax request failed because it timed out */
		ajaxRequestTimeout: "AjaxTimeout",

		/** Ajax request because the client aborted it */
		ajaxRequestAbort: "AjaxAbort",

		/** Ajax request failed because we couldn't parse the response */
		ajaxRequestParseError: "AjaxParserError",

		/** Ajax request failed because the server returned an HTTP error */
		ajaxRequestError: "AjaxError",

		/** Database action failed because the webSql database hit the maximum size it is allowed on the device */
		databaseOutOfMemory: "DatabaseOutOfMemory",

		/** Vault file download failed because the file does not exist on the server */
		serverFileNotFound: "ServerFileNotFount",

		/** Vault file upload failed because the a more recent file exists on the server */
		serverFileNewer: "ServerFileNewer",

		/** Operation is not supported or is not supported for the given arguments */
		notSupported: "NotSupported",

		/** The specified arguments are not valid */
		invalidArgs: "InvalidArgs",

		/**  The specified {@link DataModel.Field ModelField} does not exist */
		unknownModelField: "UnknownModelField",

		/**  The specified {@link DataModel.Class ModelClass} does not exist */
		unknownModelClass: "UnknownModelClass",

		/**  The specified {@link DataModel.Element ModelElement} does not exist */
		unknownModelElement: "UnknownModelElement",

		/**  The specified {@link DataModel.Collection ModelCollection} does not exist */
		unknownModelCollection: "UnknownModelCollection",

		/**  The specified value is undefined */
		missingValue: "MissingValue",

		/** The specified file is not valid */
		invalidFile: "InvalidFile",

		/** The domain name is either empty or missing (undefined/null) */
		missingDomainName: "MissingDomainName"
	};

	/** @enum Constants.RegisterDeviceCode
	 *
	 * Values returned by MDO.Connection#registerDevice errors. Exposed through `{@link MDO.Client#constants}.registerDeviceCodes`.
	 *
	 * ## Usage:
	 *
	 *     mdo.{@link MDO.Client#registerDevice registerDevice}(url, domainName, userName, password)
	 *         .then(null, function(error) {
	 *             if (error.{@link MDO.Error#mdoCode mdoCode} == {@link MDO.Client#constants mdo.constants}.errorCodes.{@link Constants.ErrorCode#registerDeviceRejected registerDeviceRejected}
	 *                 && error.rejectionReason == {@link MDO.Client#constants mdo.constants}.registerDeviceCodes.{@link Constants.RegisterDeviceCode#notSupported notSupported}) {
	 *                 alert("Device registration not supported or server misconfigured!");
	 *             }
	 *         });
	 */
	 var registerDeviceCodes = {

		 // Rejection Codes for RegisterDevice - Keep synced with AtHand.MTier.Api.ServerComponents.RegisterDeviceRejection

		 /** No server component is configured to handle device registration for this user */
		 notSupported: "DeviceRegistrationNotSupported",

		 /** The supplied user's credentials could not be authenticated */
		 invalidUserCredentials: "InvalidUserCredentials",

		 /** The user has too many devices registered */
		 userDeviceLimitExceeded: "UserDeviceLimitExceeded",

		 /** The server is out of device licenses */
		 systemDeviceLimitExceeded: "SystemDeviceLimitExceeded",

		 /**
		  * Custom error from the application; Check the `customData` property on the error for application-specific
		  * additional information.
		  */
		 applicationError: "ApplicationError"
	 };

	 /** @enum Constants.DeviceRpcCode
	 *
	 * Values returned by MDO.Connection#executeServerRpc errors. Exposed through `{@link MDO.Client#constants}.deviceRpcCodes`.
	 *
	 * ## Usage:
	 *
	 *     mdo.{@link MDO.Client#executeServerRpc executeServerRpc}(methodName, parameters)
	 *         .then(null, function(error) {
	 *             if (error.{@link MDO.Error#mdoCode mdoCode} == {@link MDO.Client#constants mdo.constants}.errorCodes.{@link Constants.ErrorCode#deviceRpcRejected deviceRpcRejected}
	 *                 && error.rejectionReason == {@link MDO.Client#constants mdo.constants}.deviceRpcCodes.{@link Constants.DeviceRpcCode#notSupported notSupported}) {
	 *                 alert("RPC not supported or server misconfigured!");
	 *             }
	 *         });
	 */
	 var deviceRpcCodes = {

		 // Rejection Codes for DeviceRpc - Keep synced with AtHand.MTier.Api.ServerComponents.DeviceRpcRejection

		 /** No server component is configured to handle this device RPC */
		 notSupported: "DeviceRpcNotSupported",

		 /** The RPC requires an authenticated device, but an anonymous call was made */
		 authenticationRequired: "AuthenticatedDeviceRequired",

		 /** The device authenticated as a user not authorized to invoke the requested RPC */
		 notAuthorized: "NotAuthorized",

		 /**
		  * Custom error from the application; Check the `customData` property on the error for application-specific
		  * additional information.
		  */
		 applicationError: "ApplicationError"
	 };

	/** @enum Constants.MessageCode
	 *
	 * Values used by the {@link Messages.Message#messageCode messageCode} property on {@link Messages.Message messages} sent via {@link Promise promises}.
	 * Exposed through `{@link MDO.Client#constants}.messageCodes`.
	 *
	 * ## Usage:
	 *
	 *		mdoCon.sync().then(null, null, function({@link Messages.Message message}) {
	 *			if(message.mdoCode == {@link MDO.Client#constants mdo.constants}.messageCodes.{@link Constants.MessageCode#uploadingFile uploadingFile}) {
	 *				alert(message.message);
	 *			}
	 *		});
	 *
	 *		...
	 *
	 *		mdoCon.sync().then(null, null, function({@link Messages.Message message}) {
	 *			if(message.mdoCode == {@link MDO.Client#constants mdo.constants}.messageCodes.{@link Constants.MessageCode#uploadingFile uploadingFile}) {
	 *				alert("Uploading file" + message.args[0] + "of" + message.args[1]);
	 *			}
	 *		});
	 *
	 *
	 */
	var messageCodes = {
		/**
		@property {string} applyingServerChanges
		Client is applying model and data changes received from the server.

		@property {Array} applyingServerChanges.args
		Definitions for each argument:

		@property {number} applyingServerChanges.args.0
		Current server change being applied.

		@property {number} applyingServerChanges.args.1
		Total number of server changes to be applied.

		@property {string} applyingServerChanges.message
		Defaults to: "Applying server change {0} of {1}"
		*/
		applyingServerChanges: "ApplyingServerChanges",
		/**
		@property {string} preparingUpload
		Client is preparing files for upload to the server.

		@property {Array} preparingUpload.args
		preparingUpload has no arguments.

		@property {string} preparingUpload.message
		Defaults to: "Preparing upload"
		*/
		preparingUpload: "PreparingUpload",
		/**
		@property {string} extractingFile
		Client is extracting an MTC file.

		@property {Array} extractingFile.args
		Definitions for each argument:

		@property {number} extractingFile.args.0
		Current MTC being extracted.

		@property {number} extractingFile.args.1
		Total number of MTCs to be extracted.

		@property {string} extractingFile.message
		Defaults to: "Extracting file {0} of {1}"
		*/
		extractingFile: "ExtractingFile",
		/**
		@property {string} resettingDatabase
		Client is deleting non-system tables from the Database.

		@property {Array} resettingDatabase.args
		resettingDatabase has no arguments.

		@property {string} resettingDatabase.message
		Defaults to: "Resetting database"
		*/
		resettingDatabase: "ResettingDatabase",
		/**
		@property {string} deployingDatabase
		Client is updating the database schema and storing the model file.

		@property {Array} deployingDatabase.args
		deployingDatabase has no arguments.

		@property {string} deployingDatabase.message
		Defaults to: "Deploying database"
		*/
		deployingDatabase: "DeployingDatabase",
		/**
		@property {string} uploadingFile
		Client is uploading an MTC file.

		@property {Array} uploadingFile.args
		Definitions for each argument:

		@property {number} uploadingFile.args.0
		Current MTC being uploaded.

		@property {number} uploadingFile.args.1
		Total number of MTCs to be uploaded.

		@property {string} uploadingFile.message
		Defaults to: "Uploading file {0} of {1}"
		*/
		uploadingFile: "UploadingFile",
		/**
		@property {string} downloadingFile
		Client is downloading an MTC file.

		@property {Array} downloadingFile.args
		Definitions for each argument:

		@property {number} downloadingFile.args.0
		Current MTC being downloaded.

		@property {number} downloadingFile.args.1
		Total number of MTCs to be downloaded.

		@property {string} downloadingFile.message
		Defaults to: "Downloading file {0} of {1}"
		*/
		downloadingFile: "DownloadingFile",
		/**
		@property {string} downloadingSegment
		Client is downloading an MTC file in file segments.

		@property {Array} downloadingSegment.args
		Definitions for each argument:

		@property {number} downloadingSegment.args.0
		Current MTC segment being downloaded.

		@property {number} downloadingSegment.args.1
		Total number of MTC segments to be downloaded.

		@property {string} downloadingSegment.message
		Defaults to: "Downloading segment {0} of {1}"
		*/
		downloadingSegment: "DownloadingSegment",
		/**
		@property {string} checkingForAttachmentUploads
		Client is checking for vault files that need to be uploaded.

		@property {Array} checkingForAttachmentUploads.args
		checkingForAttachmentUploads has no arguments.

		@property {string} checkingForAttachmentUploads.message
		Defaults to: "Checking for attachments to upload"
		*/
		checkingForAttachmentUploads: "CheckingForAttachmentUploads",
		/**
		@property {string} checkingForAttachmentDownloads
		Client is checking for vault files that need to be downloaded.

		@property {Array} checkingForAttachmentDownloads.args
		checkingForAttachmentDownloads has no arguments.

		@property {string} checkingForAttachmentDownloads.message
		Defaults to: "Checking for attachments to download"
		*/
		checkingForAttachmentDownloads: "CheckingForAttachmentDownloads",
		/**
		@property {string} downloadingVaultFiles
		Client is downloading vault files.

		@property {Array} downloadingVaultFiles.args
		Definitions for each argument:

		@property {number} downloadingVaultFiles.args.0
		Total number of vault files to be downloaded.

		@property {string} downloadingVaultFiles.message
		Defaults to: "Downloading {0} attachment(s)"
		*/
		downloadingVaultFiles: "DownloadingVaultFiles",
		/**
		@property {string} downloadingVaultFile
		Client is downloading a vault file.

		@property {Array} downloadingVaultFile.args
		Definitions for each argument:

		@property {number} downloadingVaultFile.args.0
		Current vault file being downloaded.

		@property {number} downloadingVaultFile.args.1
		Total number of vault files to be downloaded.

		@property {string} downloadingVaultFile.args.2
		Vault file name.

		@property {string} downloadingVaultFile.message
		Defaults to: "Downloading {0} of {1}: '{2}'"
		*/
		downloadingVaultFile: "DownloadingVaultFile",
		/**
		@property {string} uploadingVaultFiles
		Client is uploading vault files.

		@property {Array} uploadingVaultFiles.args
		Definitions for each argument:

		@property {number} uploadingVaultFiles.args.0
		Total number of vault files to be uploaded.

		@property {string} uploadingVaultFiles.message
		Defaults to: "Uploading {0} attachment(s)"
		*/
		uploadingVaultFiles: "UploadingVaultFiles",
		/**
		@property {string} uploadingVaultFile
		Client is uploading a vault file.

		@property {Array} uploadingVaultFile.args
		Definitions for each argument:

		@property {number} uploadingVaultFile.args.0
		Current vault file being uploaded.

		@property {number} uploadingVaultFile.args.1
		Total number of vault files to be uploaded.

		@property {string} uploadingVaultFile.args.2
		Vault file name.

		@property {string} uploadingVaultFile.message
		Defaults to: "Uploading {0} of {1}: '{2}'"
		*/
		uploadingVaultFile: "UploadingVaultFile",
		/**
		@property {string} authenticating
		Client is authenticating.

		@property {Array} authenticating.args
		authenticating has no arguments.

		@property {string} authenticating.message
		Defaults to: "Authenticating"
		*/
		authenticating: "Authenticating",
		/**
		@property {string} disconnecting
		Client is disconnecting.

		@property {Array} disconnecting.args
		disconnecting has no arguments.

		@property {string} disconnecting.message
		Defaults to: "Disconnecting"
		*/
		disconnecting: "Disconnecting",
		/**
		@property {string} requestingFiles
		Client is requesting files from the server.

		@property {Array} requestingFiles.args
		requestingFiles has no arguments.

		@property {string} requestingFiles.message
		Defaults to: "Requesting Files"
		*/
		requestingFiles: "RequestingFiles",
		/**
		 @property {string} registeringDevice
		 Client is registering the device.

		 @property {Array} registeringDevice.args
		 registeringDevice has no arguments.

		 @property {string} registeringDevice.message
		 Defaults to: 'Registering device'
		 */
		registeringDevice: "RegisteringDevice"
	};

	/** @enum Constants.ElementState
	 *
	 * Values returned by MDO.Element#mdoState property.  Exposed through `{@link MDO.Client#constants}.elementStates`.
	 *
	 * ## Usage:
	 *
	 *     if(mdoElt.{@link MDO.Element#mdoState mdoState} == {@link MDO.Client#constants mdo.constants}.elementStates.{@link Constants.ElementState#changed changed}) {
	 *         mdoElt.save();
	 *     });
	 */
	var elementStates = {
		/** Newly created element */
		new: "new",

		/** Unmodified existing element */
		saved: "saved",

		/** Modified existing element */
		changed: "changed",

		/** Deleted element */
		deleted: "deleted"
	};

	/** @enum Constants.ConnectionState
	 *
	 * Values returned by MDO.Connection#state property. Exposed through `{@link MDO.Client#constants}.connectionStates`.
	 *
	 * The connection state changes whenever {@link MDO.Connection#open} or {@link MDO.Connection#close} is called.
	 *
	 * ## Usage:
	 *
	 *     if(mdoCon.{@link MDO.Connection#state state} == {@link MDO.Client#constants mdo.constants}.connectionStates.{@link Constants.ConnectionState#closed closed}) {
	 *         mdoCon.open();
	 *     });
	 */
	var connectionStates = {
		/** @property closed
		* Connection is closed. User has no data access and cannot sync.
		*/
		closed: "closed",

		/** @property opened
		* Connection is opened, but user is not authenticated. User has read and write data access, but cannot sync.
		*/
		opened: "opened",

		/** @property privileged
		* Connection is opened and user is authenticated. User has read and write data access and can sync.
		*/
		privileged: "privileged"
	};

	// DeviceSharing enum value for AuthenticationRequest
	var deviceSharing = {
		none: "none",
		existingUser: "existingUser",
		changeUser: "changeUser"
	};

	/**
	 * @enum Constants.DevicePlatforms
	 *
	 * Values used by the {@link MDO.Client#devicePlatform} property.
	 * Exposed through `{@link MDO.Client#constants}.devicePlatforms`.
	 */
	var devicePlatforms = {
		/**
		 * @property easIos
		 * Enterprise Application Shell on an iOS device (iPad, iPhone, etc.)
		 */
		easIos: "easIos",

		/**
		 * @property easAndroid
		 * Enterprise Application Shell on an Android device (phone, tablet)
		 */
		easAndroid: "easAndroid",

		/**
		 * @property easWindows8
		 * Enterprise Application Shell on a Windows 8 device (PC, tablet)
		 */
		easWindows8: "easWindows8",

		/**
		 * @property browser
		 * Browser environment (Chrome, Safari, etc.)
		 */
		browser: "browser"
	};

	/** @enum Constants.SqlError
	  * @private
	  *
	  * Contant properties from the SQLError object.  However, the iOS sqlite plugin return Error instances
	  * without these constants, so comparisons should be done against this enum.
	  *
	  * Instead of `SQLError.CONSTRAINT_ERR` use `Constants.sqlError.CONSTRAINT_ERR`.
	  *
	  * http://www.w3.org/TR/webdatabase/#errors-and-exceptions
	  */
	var sqlError = {
		/** Unknown error */
		UNKNOWN_ERR: 0,
		/** Database error */
		DATABASE_ERR: 1,
		/** Version error */
		VERSION_ERR: 2,
		/** Too large error */
		TOO_LARGE_ERR: 3,
		/** Quota error */
		QUOTA_ERR: 4,
		/** Syntax error */
		SYNTAX_ERR: 5,
		/** Constraint error */
		CONSTRAINT_ERR: 6,
		/** Timeout error */
		TIMEOUT_ERR: 7
	};

	// Constants
	//
	/**
	 * @class Constants
	 * @singleton
	 *
	 * Enumerations used by MDO.js
	 *
	 * Exposed through {@link MDO.Client#constants}.
	 */
	return {
		/**
		 * @property {Constants.ConnectionEvent} connectionEvents
		 * @readonly
		 *
		 * Events triggered by MDO.Connection.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on({@link MDO.Client#constants mdo.constants}.connectionEvents.{@link Constants.ConnectionEvent#dataAdded dataAdded}, function(mdoElt) {
		 *         alert("An MDO Element was added!");
		 *     });
		 */
		connectionEvents: connectionEvents,
		/**
		 * @property {Constants.DataEvent} dataEvents
		 * @readonly
		 *
		 * Events triggered by MDO.FileElement
		 *
		 * ## Usage:
		 *
		 *     mdoFileElt.on({@link MDO.Client#constants mdo.constants}.dataEvents.{@link Constants.DataEvent#fileSet fileSet}, function(file) {
		 *         alert("A file has been selected!");
		 *     });
		 */
		dataEvents: dataEvents,
		/**
		 * @property {Constants.ErrorCode} errorCodes
		 * @readonly
		 *
		 * Error codes returned by the MDO operations.
		 */
		errorCodes: errorCodes,
		/**
		 * @property {Constants.MessageCode} messageCodes
		 * @readonly
		 *
		 * Progress codes given by the MDO progress notifications.
		 */
		messageCodes: messageCodes,
		/**
		 * @property {Constants.ElementState} elementStates
		 * @readonly
		 *
		 * Values returned by MDO.Element#mdoState property
		 */
		elementStates: elementStates,
		/**
		 * @property {Constants.ConnectionState} connectionStates
		 * @readonly
		 *
		 * Values returned by MDO.Connection#state property
		 */
		connectionStates: connectionStates,
		/**
		 * @property {Constants.DevicePlatforms} devicePlatforms
		 * @readonly
		 *
		 * Values returned by MDO.Client#devicePlatform property
		 */
		devicePlatforms: devicePlatforms,
		/**
		 * @property {Constants.RegisterDeviceCode} registerDeviceCode
		 * @readonly
		 *
		 * Values returned by MDO.Client#registerDeviceCodes property
		 */
		registerDeviceCodes: registerDeviceCodes,
		/**
		 * @property {Constants.DeviceRpcCode} deviceRpcCode
		 * @readonly
		 *
		 * Values returned by MDO.Client#deviceRpcCodes property
		 */
		deviceRpcCodes: deviceRpcCodes,
		deviceSharing: deviceSharing,
		/**
		 * @property {Constants.SqlError} sqlError
		 * @readonly
		 * @private
		 *
		 * Constants on SQLError class.
		 */
		sqlError: sqlError
	};
});

// MDO/Client
//
/**
 provides extensions to when.js's promises.
*/
define('lib/when-extensions',[
	"lib/when",
], function (
	when
	) {


		"use strict";
		/**
		 * @class Promise
		 *
		 */
		var promisePrototype = Object.getPrototypeOf(when.defer().promise);

		/**
		 * See Fogbugz case 10652: Update When.js.
		 * @method tap
		 *
		 * Runs a side effect when this promise fulfills, without changing the
		 * fulfillment value.
		 * @param {function} onFulfilledSideEffect
		 * @returns {Promise}
		 */
		promisePrototype.tap = function tap(onFulfilledSideEffect) {
			return this.then(onFulfilledSideEffect)['yield'](this);
		};

	});
/*!
* @hand DSS Library
*
* Copyright 2012, @hand Software Corporation
* All rights reserved
* http://www.hand.com
*/
define('AH',[
	"lib/websql",
	"lib/when",
	"lib/callbacks",
	"underscore",
	"Constants",
	"lib/when-extensions"
], function (
	websql,
	when,
	callbacks,
	_,
	Constants
	) {

	"use strict";

	/**
	* AH.js: Base functionality for @hand Javascript libraries.
	*
	**/

	// Declare a single global symbol "AH"
	return (function () {

		// ## getLocalTimeAsUtc(date)
		//
		// Converts the `date` to UTC s.t. when calling local date
		// methods on the returned date (e.g. `date.getHours()`) the returned values
		// corresponds to UTC.
		//
		function getLocalTimeAsUtc(date) {
			if (date instanceof Date) {
				return new Date(date.valueOf() + 60 * 1000 * date.getTimezoneOffset());
			}

			throw new Error("Invalid getLocalTimeAsUtc parameter: " + JSON.stringify(date));
		}

		// ## getUtcAsLocalTime(date)
		//
		// Converts the `date` from a date whose methods (e.g. `date.getHours()`) return values
		// that correspond to UTC.
		//
		function getUtcAsLocalTime(date) {
			if (date instanceof Date) {
				return new Date(date.valueOf() - 60 * 1000 * date.getTimezoneOffset());
			}

			throw new Error("Invalid getUtcAsLocalTime parameter: " + JSON.stringify(date));
		}

		// Promise construction function
		var defer = when.defer;

		/**
		* Chains defer().progress() calls by wrapping an existing promise with
		* a new deferred object that will notify with the specified message.
		*
		* @param {string/Messages.Message} msg - new message you would like to send to defer().progress()
		* @param {Deferred} promise - existing promise to pipe 'msg' notification onto
		*
		**/
		function notify(message, promise) {
			var dfd = defer();
			var updateProgress = true;

			// We need to display progress asynchronously
			// in order for the caller to be able to subscribe
			// since when.js only notifies already subscribed progress handlers
			setTimeout(sendNotification, 0);

			function sendNotification() {
				if (updateProgress) {
					dfd.progress(message);
					updateProgress = false;
				}
			}

			when(promise, function (value) {
				sendNotification();
				dfd.resolve(value);
			}, function (err) {
				sendNotification();
				dfd.reject(err);
			}, function (msg) {
				sendNotification();
				dfd.progress(msg);
			});

			return dfd.promise;
		}

		/**
		 * Chains the rejection/resolution/notification methods of 'promise' to 'dfd'
		 *
		 * @param {Deferred} promise - The promise to chain onto
		 * @param {Deferred} dfd - The deferred to be chained
		 *
		 **/
		function chainPromise(promise, dfd) {
			return when.chain(promise, dfd);
		}

		function DelayedTask(fn, scope, args) {
			var self = this,
				id;

			function call() {
				clearInterval(id);
				id = null;
				fn.apply(scope, args || []);
			}

			/**
			* Cancels any pending timeout and queues a new one
			* @param {Number} delay The milliseconds to delay
			* @param {Function} newFn (optional) Overrides function passed to constructor
			* @param {Object} newScope (optional) Overrides scope passed to constructor. Remember that if no scope
			* is specified, this will refer to the browser window.
			* @param {Array} newArgs (optional) Overrides args passed to constructor
			*/
			this.delay = function (delay, newFn, newScope, newArgs) {
				self.cancel();
				fn = newFn || fn;
				scope = newScope || scope;
				args = newArgs || args;
				id = setInterval(call, delay);
			};


			/**
			* Cancel the last queued timeout
			*/
			this.cancel = function () {
				if (id) {
					clearInterval(id);
					id = null;
				}
			};
		}

		/**
		* Emulation of C#'s string.format() method.
		* Only supports alignment and custom numeric formats
		*/

		function format() {
			if (arguments.length === 0) {
				return undefined;
			}
			var fmt = arguments[0];
			var re = /(?:\{(.*?)\})/g;
			var args = arguments;
			var text = fmt.replace(re, function (match, token) {
				var idxFmt = token.split(":", 2);
				var idxAlignment = idxFmt.shift().split(",", 2);
				var arg = args[parseInt(idxAlignment[0], 10) + 1];
				var argFmt = idxFmt.shift();

				if (isNumber(arg) && isDefined(argFmt)) {
					var leading, decimals;
					argFmt.replace(/^([0#]*)(?:\.([0#]*))?/, function (mm, lead, dec) {
						leading = lead;
						decimals = dec;
					});

					if (isDefined(leading) || isDefined(decimals)) {
						arg = String(arg.toFixed((decimals || "").length));
						var left = arg.indexOf(".");
						if (left < 0) {
							left = arg.length;
						}
						left = (leading || "").length - left;
						while (left-- > 0) {
							arg = "0" + arg;
						}
					}
				}

				if (idxAlignment.length === 2) {
					var alignment = parseInt(idxAlignment[1], 10);
					var padCount = (alignment > 0 ? alignment : -alignment) - arg.length;
					if (padCount > 0) {
						var padding = [];
						while (padCount > 0) {
							padding.push(" ");
							padCount--;
						}
						if (alignment > 0) {
							padding.push(arg);
						} else {
							padding.unshift(arg);
						}
						arg = padding.join("");
					}
				}
				return arg;
			});
			return text;
		}

		// # toFixedNumber(val, fractionalDigits)
		//
		// Converts `value` to a number with `fractionalDigits` digits of precision.
		//
		function toFixedNumber(value, fractionalDigits) {
			var fixed = isDefined(value) ? Number(Number(value).toFixed(fractionalDigits)) : value;
			if (!isNumber(fixed)) {
				throw new Error("Invalid parameter value: " + JSON.stringify(value));
			}
			return fixed;
		}

		// # boolFromDb(value)
		//
		// Turns Boolean string or number into a proper `boolean` value
		//
		function boolFromDb(value) {

			if (_.isNull(value)) {
				return null;
			}

			if (isNumber(value)) {
				return Boolean(value);
			}

			// Backwards compatibility
			value = String(value).toLowerCase();
			if (value === "true") {
				return true;
			} else if (value === "false") {
				return false;
			}

			throw new Error("Invalid parameter value: " + JSON.stringify(value));
		}

		// # boolToDb(boolValue)
		//
		// Converts a `boolean` value to number.
		//
		function boolToDb(boolValue) {

			if (!_.isBoolean(boolValue)) {
				throw new Error("Invalid parameter type: " + typeof (boolValue));
			}

			return boolValue ? 1 : 0;
		}


		/**
		* Turns date strings into proper Date objects.
		* Expected string format: 'yyyy-MM-dd HH:mm:ss'
		*/

		function dateFromDb(value) {

			// return the original value if it's already a date
			if (isDate(value)) {
				return value;
			} else if (typeof value === "string") {
				var match = (/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/).exec(value);
				if (match) {
					var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
						Number(match[4]), Number(match[5]), Number(match[6]));

					return date;
				}

				// NOTE: PhantomJS chokes on Date.parse(), need to update our build dependencies to make this work
				//				var ms = Date.parse(value);
				//				if (!_.isNaN(ms))
				//					return new Date(ms);
				// var ms = Date.parse(value);
				// if (!_.isNaN(ms))
				//	return new Date(ms);
			}

			return null;
		}

		/**
		* Converts a date objects to 'yyyy-MM-dd HH:mm:ss' format
		*/

		function dateToDb(date) {
			var strDate = format("{0:0000}-{1:00}-{2:00} {3:00}:{4:00}:{5:00}",
				date.getFullYear(), date.getMonth() + 1, date.getDate(),
				date.getHours(), date.getMinutes(), date.getSeconds()
			);

			return strDate;
		}

		/**
		* Converts a base-64 encoded string into an array of bytes
		*/
		function blobFromDb(value) {
			if (_.isUndefined(value) || _.isNull(value)) {
				return null;
			}

			var bytesStr = window.atob(value);
			var toReturn = [];
			for (var i = 0; i < bytesStr.length; i++) {
				toReturn.push(bytesStr.charCodeAt(i));
			}
			return toReturn;
		}

		/**
		* Converts an array of bytes into a base-64 encoded string
		*/
		function blobToDb(bytes) {
			if (bytes && !(bytes instanceof Array)) {
				throw new Error("blobToDb requires an array of bytes");
			}
			if (!bytes) {
				return null;
			}

			var byteStr = _.map(bytes, function (b) { return String.fromCharCode(b); }).join("");
			return window.btoa(byteStr);
		}

		/**
		* Converts an array buffer into a base-64 encoded string
		*/
		function arrayBufferToBase64String(buffer) {
			if (!isDefined(buffer)) {
				return null;
			}
			if (!(buffer instanceof ArrayBuffer)) {
				throw new Error("'buffer' is not a valid ArrayBuffer.");
			}

			var binary = "";
			var bytes = new Uint8Array(buffer);
			var len = bytes.byteLength;

			for (var i = 0; i < len; i++) {
				binary += String.fromCharCode(bytes[i]);
			}

			return window.btoa(binary);
		}

		/**
		* Converts a base-64 encoded string into an array buffer
		*/
		function base64StringToArrayBuffer(base64) {
			if (!isDefined(base64)) {
				return null;
			}
			if (!_.isString(base64)) {
				throw new Error("'base64' is not a valid String.");
			}
			var binary = window.atob(base64);
			var binaryLength = binary.length;

			var arrayBuffer = new ArrayBuffer(binaryLength);
			var array = new Uint8Array(arrayBuffer);

			for (var i = 0; i < binaryLength; i++) {
				array[i] = binary.charCodeAt(i);
			}

			return arrayBuffer;
		}

		/**
		* Creates a Blob from data (ArrayBuffer or Blob) with optional mimeType.
		*
		* Uses the Blob() constructor, if available, otherwise (on PhantomJS) it falls back on BlobBuilder().
		*/
		function createBlob(data, mimeType) {
			var BlobBuilder = window.BlobBuilder
				|| window.WebKitBlobBuilder
				|| window.MozBlobBuilder
				|| window.MSBlobBuilder;

			if (BlobBuilder) {
				var bb = new BlobBuilder();
				bb.append(data);
				return bb.getBlob(mimeType);
			} else if (window.Blob) {
				var options = mimeType ? { type: mimeType } : {};
				return new Blob([data], options);
			}

			throw new Error("Blob creation is not supported");
		}

		/**
		* Returns true if value isn't null or undefined
		*/

		function isDefined(value) {
			return value !== null && value !== undefined;
		}

		function isDate(value) {
			return value instanceof Date;
		}

		function isBoolean(value) {
			return typeof value === "boolean";
		}

		function isNumber(value) {
			return typeof value === "number" && isFinite(value);
		}

		function isString(value) {
			return typeof value === "string";
		}

		function isEmpty(value) {
			return (!isDefined(value)
				|| (value === "")
					|| (isArray(value) && !value.length));
		}

		function isArray(value) {
			return Object.prototype.toString.call(value) === "[object Array]";
		}

		/**
		*
		* @param target An object that will receive the new properties.
		* @param config An object containing additional properties to merge in.
		* @param defaults An optional object containing default values that will be assigned before config is applied.
		*/

		function apply(object, config, defaults) {
			if (!(typeof object === "object"
				&& typeof config === "object")) {
				return object;
			}
			if (typeof defaults === "object") {
				object = apply(object, defaults);
			}
			_.forEach(config, function(val, key) {
				object[key] = val;
			});
			return object;
		}

		// ### cachedArrayLookup(objArr, property, value, failureCallback) ###
		//
		// Takes an array of homogeneous objects `objArr` and returns
		// the element whose `elt[property] === value`.
		//
		// The function modifies the objArr by adding a `caches` property
		// to speed up future lookups
		//
		// failureCallback: Function to be called when value doesn't exist
		//
		function cachedArrayLookup(objArr, property, value, failureCallback) {
			var caches = objArr.caches || (objArr.caches = {});
			var cache = caches[property];
			if (!cache) {
				caches[property] = cache = {};
				_.each(objArr, function (elt) {
					cache[elt[property]] = elt;
				});
			}

			if (!(value in cache) && failureCallback) {
				failureCallback();
			}

			return cache[value];
		}

		// ### appendArray(theArray, secondArray)
		//
		// Appends all elements in secondArray to theArray.
		//
		// Returns theArray.
		//
		function appendArray(theArray, suffix) {
			_.forEach(suffix, function(elt) {
				theArray.push(elt);
			});
			return theArray;
		}

		// ### deferredTryCatch(deferredCallback, _ctx_)
		//
		// Wraps a call to `deferredCallback` (which should be returning a promise) with a try/catch block.
		// If the `deferredCallback` throws an exception `err`, this function returns a
		// promise rejected with `{ error: err }`
		//
		function deferredTryCatch(deferredCallback, ctx) {
			try {
				return deferredCallback.call(ctx);
			} catch (err) {
				if (!(err instanceof Error)) {
					return reject(new Error(err));
				}
				return reject(err);
			}
		}

		// ### resolve(value)
		//
		// Returns a `promise` that has been resolved with `value`
		//
		function resolve(value) {
			return when.resolve(value);
		}

		// ### reject(err)
		//
		// Returns a `promise` that has been rejected with `err`
		//
		function reject(err) {
			return when.reject(err);
		}

		/**
		 * @method whenSettle
		 *
		 * Return a promise that will always fulfill with the promise states of the given promises.
		 *
		 * @param {Array.<Promise>} Array of promises
		 *
		 * @returns {Array.<Object>} Array of state descriptors
		 *
		 * @return {string} return.state
		 * Settled state of the promise. Either `fulfilled` or `rejected`
		 *
		 * @return {Object} return.value
		 * Fulfilment value of a resolved promise.
		 *
		 * @return {Object} return.reason
		 * Rejection reason for a rejected promise.
		 *
		 */
		function whenSettle(promises) {
			return when.all(_.map(promises, function(promise) {
				return promise.then(function(value) {
					return {
						state: "fulfilled",
						value: value
					};
				}, function(reason) {
					return {
						state: "rejected",
						reason: reason
					};
				});
			}));
		}

		// Configure websql.js to use specific promise library
		websql.config({
			defer: defer
		});

		// ### normalizeWebSqlError(error)
		//
		// Converts a WebSQL error into an MDO error based upon the `errorCode` property
		// or the `sqlError.code` property.
		//
		function normalizeWebSqlError(error) {
			// If the error has already been normalized, don't run again.
			if (error.mdoCode) {
				return error;
			}
			if (error.errorCode) {
				switch (error.errorCode) {
					case websql.errorCodes.skippedStatements:
						error.message = "Database transaction interrupted by user interaction. Please sync again.";
						error.mdoCode = Constants.errorCodes.uiInterruptedTransaction;
						break;
					case websql.errorCodes.skippedCallback:
						error.message = "Database transaction interrupted by user interaction. Please sync again.";
						error.mdoCode = Constants.errorCodes.uiSkippedTransaction;
						break;
					default:
						break;
				}
			} else if (error.sqlError) {
				if (!Constants.sqlError.QUOTA_ERR) {
					error.message = "Unknown SQL Error: " + error.sqlError.message;
				}
				switch (error.sqlError.code) {
					case Constants.sqlError.QUOTA_ERR:
						error.message = "Database quota exceeded.";
						error.mdoCode = Constants.errorCodes.databaseOutOfMemory;
						break;
					default:
						break;
				}
			}

			return error;
		}

		// ### whenCallViaCallback(fn, ctx, [*args])
		//
		// Takes a `traditional` callback-taking function and returns a promise for its result.
		// It assumes that the function takes its callback and errback as
		// the last two arguments. The resolution of the promise depends on whether the
		// function will call its callback or its errback.
		//
		//	* fn: function to be called and wrapped with the promise.
		//	* ctx: context (this) that `fn` should be executed in.
		//	* [*args]: arguments that will be forwarded to the function
		//
		function whenCallViaCallbacks(fn, ctx) {
			if (ctx) {
				fn = _.bind(fn, ctx);
			}

			if (arguments.length <= 2) {
				return callbacks.call(fn);
			}

			var args = Array.prototype.slice.call(arguments, 2);
			return callbacks.apply(fn, args);
		}

		// ### bindCallViaCallbacks(fn, ctx, [*args])
		//
		// Takes a 'traditional' callback/errback-taking function and returns a function
		// that returns a promise instead. The resolution/rejection of the promise
		// depends on whether the original function will call its callback or its
		// errback.
		//
		// If additional arguments are passed to the `bind` call, they will be prepended
		// on the calls to the original function, much like `Function.prototype.bind`.
		//
		//	* fn: function to be called and wrapped with the promise.
		//	* ctx: context (this) that `fn` should be executed in.
		//	* [*args]: arguments that will be bound to the function
		//
		function bindCallViaCallbacks(fn, ctx) {
			if (ctx) {
				fn = _.bind(fn, ctx);
			}

			if (arguments.length <= 2) {
				return callbacks.bind(fn);
			}

			var args = Array.prototype.slice.call(arguments, 2);
			args.unshift(fn);
			return callbacks.bind.apply(callbacks, args);
		}

		/**
		 * @method isOnline
		 *
		 * @return true iff the browser is online. Otherwise, returns false.
		 */
		function isOnline() {
			return window.navigator.onLine;
		}

		return {
			getLocalTimeAsUtc: getLocalTimeAsUtc,
			getUtcAsLocalTime: getUtcAsLocalTime,
			format: format,
			toFixedNumber: toFixedNumber,
			boolFromDb: boolFromDb,
			boolToDb: boolToDb,
			dateFromDb: dateFromDb,
			dateToDb: dateToDb,
			blobFromDb: blobFromDb,
			blobToDb: blobToDb,
			arrayBufferToBase64String: arrayBufferToBase64String,
			base64StringToArrayBuffer: base64StringToArrayBuffer,
			createBlob: createBlob,
			notify: notify,
			chainPromise: chainPromise,
			DelayedTask: DelayedTask,

			isDefined: isDefined,
			isBoolean: isBoolean,
			isDate: isDate,
			isNumber: isNumber,
			isString: isString,
			isEmpty: isEmpty,
			isArray: isArray,
			apply: apply,
			cachedArrayLookup: cachedArrayLookup,
			appendArray: appendArray,
			deferredTryCatch: deferredTryCatch,

			when: when,
			whenAll: when.all,
			whenSettle: whenSettle,
			defer: defer,
			resolve: resolve,
			reject: reject,
			whenCallViaCallbacks: whenCallViaCallbacks,
			bindCallViaCallbacks: bindCallViaCallbacks,

			websql: websql,
			normalizeWebSqlError: normalizeWebSqlError,

			isOnline: isOnline
		};
	}());
});
//     Backbone.js 1.0.0

//     (c) 2010-2013 Jeremy Ashkenas, DocumentCloud Inc.
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

(function(){

  // Initial Setup
  // -------------

  // Save a reference to the global object (`window` in the browser, `exports`
  // on the server).
  var root = this;

  // Save the previous value of the `Backbone` variable, so that it can be
  // restored later on, if `noConflict` is used.
  var previousBackbone = root.Backbone;

  // Create local references to array methods we'll want to use later.
  var array = [];
  var push = array.push;
  var slice = array.slice;
  var splice = array.splice;

  // The top-level namespace. All public Backbone classes and modules will
  // be attached to this. Exported for both the browser and the server.
  var Backbone;
  if (typeof exports !== 'undefined') {
    Backbone = exports;
  } else {
    Backbone = root.Backbone = {};
  }

  // Current version of the library. Keep in sync with `package.json`.
  Backbone.VERSION = '1.0.0';

  // Require Underscore, if we're on the server, and it's not already present.
  var _ = root._;
  if (!_ && (typeof require !== 'undefined')) _ = require('underscore');

  // For Backbone's purposes, jQuery, Zepto, Ender, or My Library (kidding) owns
  // the `$` variable.
  Backbone.$ = root.jQuery || root.Zepto || root.ender || root.$;

  // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
  // to its previous owner. Returns a reference to this Backbone object.
  Backbone.noConflict = function() {
    root.Backbone = previousBackbone;
    return this;
  };

  // Turn on `emulateHTTP` to support legacy HTTP servers. Setting this option
  // will fake `"PUT"` and `"DELETE"` requests via the `_method` parameter and
  // set a `X-Http-Method-Override` header.
  Backbone.emulateHTTP = false;

  // Turn on `emulateJSON` to support legacy servers that can't deal with direct
  // `application/json` requests ... will encode the body as
  // `application/x-www-form-urlencoded` instead and will send the model in a
  // form param named `model`.
  Backbone.emulateJSON = false;

  // Backbone.Events
  // ---------------

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Backbone.Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }

      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeners = this._listeners;
      if (!listeners) return this;
      var deleteListener = !name && !callback;
      if (typeof name === 'object') callback = this;
      if (obj) (listeners = {})[obj._listenerId] = obj;
      for (var id in listeners) {
        listeners[id].off(name, callback, this);
        if (deleteListener) delete this._listeners[id];
      }
      return this;
    }

  };

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
    }
  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeners = this._listeners || (this._listeners = {});
      var id = obj._listenerId || (obj._listenerId = _.uniqueId('l'));
      listeners[id] = obj;
      if (typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Allow the `Backbone` object to serve as a global event bus, for folks who
  // want global "pubsub" in a convenient place.
  _.extend(Backbone, Events);

  // Backbone.Model
  // --------------

  // Backbone **Models** are the basic data object in the framework --
  // frequently representing a row in a table in a database on your server.
  // A discrete chunk of data and a bunch of useful, related methods for
  // performing computations and transformations on that data.

  // Create a new model with the specified attributes. A client id (`cid`)
  // is automatically generated and assigned for you.
  var Model = Backbone.Model = function(attributes, options) {
    var defaults;
    var attrs = attributes || {};
    options || (options = {});
    this.cid = _.uniqueId('c');
    this.attributes = {};
    _.extend(this, _.pick(options, modelOptions));
    if (options.parse) attrs = this.parse(attrs, options) || {};
    if (defaults = _.result(this, 'defaults')) {
      attrs = _.defaults({}, attrs, defaults);
    }
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // A list of options to be attached directly to the model, if provided.
  var modelOptions = ['url', 'urlRoot', 'collection'];

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The value returned during the last failed validation.
    validationError: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default -- but override this if you need
    // custom syncing semantics for *this* particular model.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // Set a hash of model attributes on the object, firing `"change"`. This is
    // the core primitive operation of a model, updating the data and notifying
    // anyone who needs to know about the change in state. The heart of the beast.
    set: function(key, val, options) {
      var attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = true;
        for (var i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      // You might be wondering why there's a `while` loop here. Changes can
      // be recursively nested within `"change"` events.
      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"`. `unset` is a noop
    // if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"`.
    clear: function(options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var val, changed = false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      for (var attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overridden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      var attrs, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      // If we're not waiting and attributes exist, save acts as `set(attr).save(null, opts)`.
      if (attrs && (!options || !options.wait) && !this.set(attrs, options)) return false;

      options = _.extend({validate: true}, options);

      // Do not persist invalid models.
      if (!this._validate(attrs, options)) return false;

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        var serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;

      var destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(resp) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      if (this.isNew()) {
        options.success();
        return false;
      }
      wrapError(this, options);

      var xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      var base = _.result(this, 'urlRoot') || _.result(this.collection, 'url') || urlError();
      if (this.isNew()) return base;
      return base + (base.charAt(base.length - 1) === '/' ? '' : '/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return this.id == null;
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return this._validate({}, _.extend(options || {}, { validate: true }));
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options || {}, {validationError: error}));
      return false;
    }

  });

  // Underscore methods that we want to implement on the Model.
  var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

  // Mix in each Underscore method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.attributes);
      return _[method].apply(_, args);
    };
  });

  // Backbone.Collection
  // -------------------

  // If models tend to represent a single row of data, a Backbone Collection is
  // more analagous to a table full of data ... or a small slice or page of that
  // table, or a collection of rows that belong together for a particular reason
  // -- all of the messages in this particular folder, all of the documents
  // belonging to this particular author, and so on. Collections maintain
  // indexes of their models, both in order, and for lookup by `id`.

  // Create a new **Collection**, perhaps to contain a specific type of `model`.
  // If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.
  var Collection = Backbone.Collection = function(models, options) {
    options || (options = {});
    if (options.url) this.url = options.url;
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // Default options for `Collection#set`.
  var setOptions = {add: true, remove: true, merge: true};
  var addOptions = {add: true, merge: false, remove: false};

  // Define the Collection's inheritable methods.
  _.extend(Collection.prototype, Events, {

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    model: Model,

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // The JSON representation of a Collection is an array of the
    // models' attributes.
    toJSON: function(options) {
      return this.map(function(model){ return model.toJSON(options); });
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Add a model, or list of models to the set.
    add: function(models, options) {
      return this.set(models, _.defaults(options || {}, addOptions));
    },

    // Remove a model, or a list of models from the set.
    remove: function(models, options) {
      models = _.isArray(models) ? models.slice() : [models];
      options || (options = {});
      var i, l, index, model;
      for (i = 0, l = models.length; i < l; i++) {
        model = this.get(models[i]);
        if (!model) continue;
        delete this._byId[model.id];
        delete this._byId[model.cid];
        index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model);
      }
      return this;
    },

    // Update a collection by `set`-ing a new list of models, adding new ones,
    // removing models that are no longer present, and merging models that
    // already exist in the collection, as necessary. Similar to **Model#set**,
    // the core operation for updating the data contained by the collection.
    set: function(models, options) {
      options = _.defaults(options || {}, setOptions);
      if (options.parse) models = this.parse(models, options);
      if (!_.isArray(models)) models = models ? [models] : [];
      var i, l, model, attrs, existing, sort;
      var at = options.at;
      var sortable = this.comparator && (at == null) && options.sort !== false;
      var sortAttr = _.isString(this.comparator) ? this.comparator : null;
      var toAdd = [], toRemove = [], modelMap = {};

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      for (i = 0, l = models.length; i < l; i++) {
        if (!(model = this._prepareModel(models[i], options))) continue;

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(model)) {
          if (options.remove) modelMap[existing.cid] = true;
          if (options.merge) {
            existing.set(model.attributes, options);
            if (sortable && !sort && existing.hasChanged(sortAttr)) sort = true;
          }

        // This is a new model, push it to the `toAdd` list.
        } else if (options.add) {
          toAdd.push(model);

          // Listen to added models' events, and index models for lookup by
          // `id` and by `cid`.
          model.on('all', this._onModelEvent, this);
          this._byId[model.cid] = model;
          if (model.id != null) this._byId[model.id] = model;
        }
      }

      // Remove nonexistent models if appropriate.
      if (options.remove) {
        for (i = 0, l = this.length; i < l; ++i) {
          if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
        }
        if (toRemove.length) this.remove(toRemove, options);
      }

      // See if sorting is needed, update `length` and splice in new models.
      if (toAdd.length) {
        if (sortable) sort = true;
        this.length += toAdd.length;
        if (at != null) {
          splice.apply(this.models, [at, 0].concat(toAdd));
        } else {
          push.apply(this.models, toAdd);
        }
      }

      // Silently sort the collection if appropriate.
      if (sort) this.sort({silent: true});

      if (options.silent) return this;

      // Trigger `add` events.
      for (i = 0, l = toAdd.length; i < l; i++) {
        (model = toAdd[i]).trigger('add', model, this, options);
      }

      // Trigger `sort` if the collection was sorted.
      if (sort) this.trigger('sort', this, options);
      return this;
    },

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any granular `add` or `remove` events. Fires `reset` when finished.
    // Useful for bulk operations and optimizations.
    reset: function(models, options) {
      options || (options = {});
      for (var i = 0, l = this.models.length; i < l; i++) {
        this._removeReference(this.models[i]);
      }
      options.previousModels = this.models;
      this._reset();
      this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return this;
    },

    // Add a model to the end of the collection.
    push: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: this.length}, options));
      return model;
    },

    // Remove a model from the end of the collection.
    pop: function(options) {
      var model = this.at(this.length - 1);
      this.remove(model, options);
      return model;
    },

    // Add a model to the beginning of the collection.
    unshift: function(model, options) {
      model = this._prepareModel(model, options);
      this.add(model, _.extend({at: 0}, options));
      return model;
    },

    // Remove a model from the beginning of the collection.
    shift: function(options) {
      var model = this.at(0);
      this.remove(model, options);
      return model;
    },

    // Slice out a sub-array of models from the collection.
    slice: function(begin, end) {
      return this.models.slice(begin, end);
    },

    // Get a model from the set by id.
    get: function(obj) {
      if (obj == null) return void 0;
      return this._byId[obj.id != null ? obj.id : obj.cid || obj];
    },

    // Get the model at the given index.
    at: function(index) {
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where: function(attrs, first) {
      if (_.isEmpty(attrs)) return first ? void 0 : [];
      return this[first ? 'find' : 'filter'](function(model) {
        for (var key in attrs) {
          if (attrs[key] !== model.get(key)) return false;
        }
        return true;
      });
    },

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere: function(attrs) {
      return this.where(attrs, true);
    },

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort: function(options) {
      if (!this.comparator) throw new Error('Cannot sort a set without a comparator');
      options || (options = {});

      // Run sort based on type of `comparator`.
      if (_.isString(this.comparator) || this.comparator.length === 1) {
        this.models = this.sortBy(this.comparator, this);
      } else {
        this.models.sort(_.bind(this.comparator, this));
      }

      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // Figure out the smallest index at which a model should be inserted so as
    // to maintain order.
    sortedIndex: function(model, value, context) {
      value || (value = this.comparator);
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _.sortedIndex(this.models, model, iterator, context);
    },

    // Pluck an attribute from each model in the collection.
    pluck: function(attr) {
      return _.invoke(this.models, 'get', attr);
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      var collection = this;
      options.success = function(resp) {
        var method = options.reset ? 'reset' : 'set';
        collection[method](resp, options);
        if (success) success(collection, resp, options);
        collection.trigger('sync', collection, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      if (!(model = this._prepareModel(model, options))) return false;
      if (!options.wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(resp) {
        if (options.wait) collection.add(model, options);
        if (success) success(model, resp, options);
      };
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models);
    },

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    _reset: function() {
      this.length = 0;
      this.models = [];
      this._byId  = {};
    },

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    _prepareModel: function(attrs, options) {
      if (attrs instanceof Model) {
        if (!attrs.collection) attrs.collection = this;
        return attrs;
      }
      options || (options = {});
      options.collection = this;
      var model = new this.model(attrs, options);
      if (!model._validate(attrs, options)) {
        this.trigger('invalid', this, attrs, options);
        return false;
      }
      return model;
    },

    // Internal method to sever a model's ties to a collection.
    _removeReference: function(model) {
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    _onModelEvent: function(event, model, collection, options) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (model && event === 'change:' + model.idAttribute) {
        delete this._byId[model.previous(model.idAttribute)];
        if (model.id != null) this._byId[model.id] = model;
      }
      this.trigger.apply(this, arguments);
    }

  });

  // Underscore methods that we want to implement on the Collection.
  // 90% of the core usefulness of Backbone Collections is actually implemented
  // right here:
  var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'indexOf', 'shuffle', 'lastIndexOf',
    'isEmpty', 'chain'];

  // Mix in each Underscore method as a proxy to `Collection#models`.
  _.each(methods, function(method) {
    Collection.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.models);
      return _[method].apply(_, args);
    };
  });

  // Underscore methods that take a property name as an argument.
  var attributeMethods = ['groupBy', 'countBy', 'sortBy'];

  // Use attributes instead of properties.
  _.each(attributeMethods, function(method) {
    Collection.prototype[method] = function(value, context) {
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _[method](this.models, iterator, context);
    };
  });

  // Backbone.View
  // -------------

  // Backbone Views are almost more convention than they are actual code. A View
  // is simply a JavaScript object that represents a logical chunk of UI in the
  // DOM. This might be a single item, an entire list, a sidebar or panel, or
  // even the surrounding frame which wraps your whole app. Defining a chunk of
  // UI as a **View** allows you to define your DOM events declaratively, without
  // having to worry about render order ... and makes it easy for the view to
  // react to specific changes in the state of your models.

  // Creating a Backbone.View creates its initial element outside of the DOM,
  // if an existing element is not provided...
  var View = Backbone.View = function(options) {
    this.cid = _.uniqueId('view');
    this._configure(options || {});
    this._ensureElement();
    this.initialize.apply(this, arguments);
    this.delegateEvents();
  };

  // Cached regex to split keys for `delegate`.
  var delegateEventSplitter = /^(\S+)\s*(.*)$/;

  // List of view options to be merged as properties.
  var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

  // Set up all inheritable **Backbone.View** properties and methods.
  _.extend(View.prototype, Events, {

    // The default `tagName` of a View's element is `"div"`.
    tagName: 'div',

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be prefered to global lookups where possible.
    $: function(selector) {
      return this.$el.find(selector);
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // **render** is the core function that your view should override, in order
    // to populate its element (`this.el`), with the appropriate HTML. The
    // convention is for **render** to always return `this`.
    render: function() {
      return this;
    },

    // Remove this view by taking the element out of the DOM, and removing any
    // applicable Backbone.Events listeners.
    remove: function() {
      this.$el.remove();
      this.stopListening();
      return this;
    },

    // Change the view's element (`this.el` property), including event
    // re-delegation.
    setElement: function(element, delegate) {
      if (this.$el) this.undelegateEvents();
      this.$el = element instanceof Backbone.$ ? element : Backbone.$(element);
      this.el = this.$el[0];
      if (delegate !== false) this.delegateEvents();
      return this;
    },

    // Set callbacks, where `this.events` is a hash of
    //
    // *{"event selector": "callback"}*
    //
    //     {
    //       'mousedown .title':  'edit',
    //       'click .button':     'save'
    //       'click .open':       function(e) { ... }
    //     }
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    // This only works for delegate-able events: not `focus`, `blur`, and
    // not `change`, `submit`, and `reset` in Internet Explorer.
    delegateEvents: function(events) {
      if (!(events || (events = _.result(this, 'events')))) return this;
      this.undelegateEvents();
      for (var key in events) {
        var method = events[key];
        if (!_.isFunction(method)) method = this[events[key]];
        if (!method) continue;

        var match = key.match(delegateEventSplitter);
        var eventName = match[1], selector = match[2];
        method = _.bind(method, this);
        eventName += '.delegateEvents' + this.cid;
        if (selector === '') {
          this.$el.on(eventName, method);
        } else {
          this.$el.on(eventName, selector, method);
        }
      }
      return this;
    },

    // Clears all callbacks previously bound to the view with `delegateEvents`.
    // You usually don't need to use this, but may wish to if you have multiple
    // Backbone views attached to the same DOM element.
    undelegateEvents: function() {
      this.$el.off('.delegateEvents' + this.cid);
      return this;
    },

    // Performs the initial configuration of a View with a set of options.
    // Keys with special meaning *(e.g. model, collection, id, className)* are
    // attached directly to the view.  See `viewOptions` for an exhaustive
    // list.
    _configure: function(options) {
      if (this.options) options = _.extend({}, _.result(this, 'options'), options);
      _.extend(this, _.pick(options, viewOptions));
      this.options = options;
    },

    // Ensure that the View has a DOM element to render into.
    // If `this.el` is a string, pass it through `$()`, take the first
    // matching element, and re-assign it to `el`. Otherwise, create
    // an element from the `id`, `className` and `tagName` properties.
    _ensureElement: function() {
      if (!this.el) {
        var attrs = _.extend({}, _.result(this, 'attributes'));
        if (this.id) attrs.id = _.result(this, 'id');
        if (this.className) attrs['class'] = _.result(this, 'className');
        var $el = Backbone.$('<' + _.result(this, 'tagName') + '>').attr(attrs);
        this.setElement($el, false);
      } else {
        this.setElement(_.result(this, 'el'), false);
      }
    }

  });

  // Backbone.sync
  // -------------

  // Override this function to change the manner in which Backbone persists
  // models to the server. You will be passed the type of request, and the
  // model in question. By default, makes a RESTful Ajax request
  // to the model's `url()`. Some possible customizations could be:
  //
  // * Use `setTimeout` to batch rapid-fire updates into a single request.
  // * Send up the models as XML instead of JSON.
  // * Persist models via WebSockets instead of Ajax.
  //
  // Turn on `Backbone.emulateHTTP` in order to send `PUT` and `DELETE` requests
  // as `POST`, with a `_method` parameter containing the true HTTP method,
  // as well as all requests with the body as `application/x-www-form-urlencoded`
  // instead of `application/json` with the model in a param named `model`.
  // Useful when interfacing with server-side languages like **PHP** that make
  // it difficult to read the body of `PUT` requests.
  Backbone.sync = function(method, model, options) {
    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // If we're sending a `PATCH` request, and we're in an old Internet Explorer
    // that still has ActiveX enabled by default, override jQuery to use that
    // for XHR instead. Remove this line when jQuery supports `PATCH` on IE8.
    if (params.type === 'PATCH' && window.ActiveXObject &&
          !(window.external && window.external.msActiveXFilteringEnabled)) {
      params.xhr = function() {
        return new ActiveXObject("Microsoft.XMLHTTP");
      };
    }

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
  };

  // Set the default implementation of `Backbone.ajax` to proxy through to `$`.
  // Override this if you'd like to use a different library.
  Backbone.ajax = function() {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };

  // Backbone.Router
  // ---------------

  // Routers map faux-URLs to actions, and fire events when routes are
  // matched. Creating a new one sets its `routes` hash, if not set statically.
  var Router = Backbone.Router = function(options) {
    options || (options = {});
    if (options.routes) this.routes = options.routes;
    this._bindRoutes();
    this.initialize.apply(this, arguments);
  };

  // Cached regular expressions for matching named param parts and splatted
  // parts of route strings.
  var optionalParam = /\((.*?)\)/g;
  var namedParam    = /(\(\?)?:\w+/g;
  var splatParam    = /\*\w+/g;
  var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  // Set up all inheritable **Backbone.Router** properties and methods.
  _.extend(Router.prototype, Events, {

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Manually bind a single named route to a callback. For example:
    //
    //     this.route('search/:query/p:num', 'search', function(query, num) {
    //       ...
    //     });
    //
    route: function(route, name, callback) {
      if (!_.isRegExp(route)) route = this._routeToRegExp(route);
      if (_.isFunction(name)) {
        callback = name;
        name = '';
      }
      if (!callback) callback = this[name];
      var router = this;
      Backbone.history.route(route, function(fragment) {
        var args = router._extractParameters(route, fragment);
        callback && callback.apply(router, args);
        router.trigger.apply(router, ['route:' + name].concat(args));
        router.trigger('route', name, args);
        Backbone.history.trigger('route', router, name, args);
      });
      return this;
    },

    // Simple proxy to `Backbone.history` to save a fragment into the history.
    navigate: function(fragment, options) {
      Backbone.history.navigate(fragment, options);
      return this;
    },

    // Bind all defined routes to `Backbone.history`. We have to reverse the
    // order of the routes here to support behavior where the most general
    // routes can be defined at the bottom of the route map.
    _bindRoutes: function() {
      if (!this.routes) return;
      this.routes = _.result(this, 'routes');
      var route, routes = _.keys(this.routes);
      while ((route = routes.pop()) != null) {
        this.route(route, this.routes[route]);
      }
    },

    // Convert a route string into a regular expression, suitable for matching
    // against the current location hash.
    _routeToRegExp: function(route) {
      route = route.replace(escapeRegExp, '\\$&')
                   .replace(optionalParam, '(?:$1)?')
                   .replace(namedParam, function(match, optional){
                     return optional ? match : '([^\/]+)';
                   })
                   .replace(splatParam, '(.*?)');
      return new RegExp('^' + route + '$');
    },

    // Given a route, and a URL fragment that it matches, return the array of
    // extracted decoded parameters. Empty or unmatched parameters will be
    // treated as `null` to normalize cross-browser behavior.
    _extractParameters: function(route, fragment) {
      var params = route.exec(fragment).slice(1);
      return _.map(params, function(param) {
        return param ? decodeURIComponent(param) : null;
      });
    }

  });

  // Backbone.History
  // ----------------

  // Handles cross-browser history management, based on either
  // [pushState](http://diveintohtml5.info/history.html) and real URLs, or
  // [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
  // and URL fragments. If the browser supports neither (old IE, natch),
  // falls back to polling.
  var History = Backbone.History = function() {
    this.handlers = [];
    _.bindAll(this, 'checkUrl');

    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
      this.location = window.location;
      this.history = window.history;
    }
  };

  // Cached regex for stripping a leading hash/slash and trailing space.
  var routeStripper = /^[#\/]|\s+$/g;

  // Cached regex for stripping leading and trailing slashes.
  var rootStripper = /^\/+|\/+$/g;

  // Cached regex for detecting MSIE.
  var isExplorer = /msie [\w.]+/;

  // Cached regex for removing a trailing slash.
  var trailingSlash = /\/$/;

  // Has the history handling already been started?
  History.started = false;

  // Set up all inheritable **Backbone.History** properties and methods.
  _.extend(History.prototype, Events, {

    // The default interval to poll for hash changes, if necessary, is
    // twenty times a second.
    interval: 50,

    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash: function(window) {
      var match = (window || this).location.href.match(/#(.*)$/);
      return match ? match[1] : '';
    },

    // Get the cross-browser normalized URL fragment, either from the URL,
    // the hash, or the override.
    getFragment: function(fragment, forcePushState) {
      if (fragment == null) {
        if (this._hasPushState || !this._wantsHashChange || forcePushState) {
          fragment = this.location.pathname;
          var root = this.root.replace(trailingSlash, '');
          if (!fragment.indexOf(root)) fragment = fragment.substr(root.length);
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start: function(options) {
      if (History.started) throw new Error("Backbone.history has already been started");
      History.started = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options          = _.extend({}, {root: '/'}, this.options, options);
      this.root             = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._wantsPushState  = !!this.options.pushState;
      this._hasPushState    = !!(this.options.pushState && this.history && this.history.pushState);
      var fragment          = this.getFragment();
      var docMode           = document.documentMode;
      var oldIE             = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      if (oldIE && this._wantsHashChange) {
        this.iframe = Backbone.$('<iframe src="javascript:0" tabindex="-1" />').hide().appendTo('body')[0].contentWindow;
        this.navigate(fragment);
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._hasPushState) {
        Backbone.$(window).on('popstate', this.checkUrl);
      } else if (this._wantsHashChange && ('onhashchange' in window) && !oldIE) {
        Backbone.$(window).on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      // Determine if we need to change the base url, for a pushState link
      // opened by a non-pushState browser.
      this.fragment = fragment;
      var loc = this.location;
      var atRoot = loc.pathname.replace(/[^\/]$/, '$&/') === this.root;

      // If we've started off with a route from a `pushState`-enabled browser,
      // but we're currently in a browser that doesn't support it...
      if (this._wantsHashChange && this._wantsPushState && !this._hasPushState && !atRoot) {
        this.fragment = this.getFragment(null, true);
        this.location.replace(this.root + this.location.search + '#' + this.fragment);
        // Return immediately as browser will do redirect to new url
        return true;

      // Or if we've started out with a hash-based route, but we're currently
      // in a browser where it could be `pushState`-based instead...
      } else if (this._wantsPushState && this._hasPushState && atRoot && loc.hash) {
        this.fragment = this.getHash().replace(routeStripper, '');
        this.history.replaceState({}, document.title, this.root + this.fragment + loc.search);
      }

      if (!this.options.silent) return this.loadUrl();
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop: function() {
      Backbone.$(window).off('popstate', this.checkUrl).off('hashchange', this.checkUrl);
      clearInterval(this._checkUrlInterval);
      History.started = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route: function(route, callback) {
      this.handlers.unshift({route: route, callback: callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl: function(e) {
      var current = this.getFragment();
      if (current === this.fragment && this.iframe) {
        current = this.getFragment(this.getHash(this.iframe));
      }
      if (current === this.fragment) return false;
      if (this.iframe) this.navigate(current);
      this.loadUrl() || this.loadUrl(this.getHash());
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl: function(fragmentOverride) {
      var fragment = this.fragment = this.getFragment(fragmentOverride);
      var matched = _.any(this.handlers, function(handler) {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
      return matched;
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate: function(fragment, options) {
      if (!History.started) return false;
      if (!options || options === true) options = {trigger: options};
      fragment = this.getFragment(fragment || '');
      if (this.fragment === fragment) return;
      this.fragment = fragment;
      var url = this.root + fragment;

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._hasPushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getFragment(this.getHash(this.iframe)))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          if(!options.replace) this.iframe.document.open().close();
          this._updateHash(this.iframe.location, fragment, options.replace);
        }

      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) this.loadUrl(fragment);
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash: function(location, fragment, replace) {
      if (replace) {
        var href = location.href.replace(/(javascript:|#).*$/, '');
        location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        location.hash = '#' + fragment;
      }
    }

  });

  // Create the default Backbone.history.
  Backbone.history = new History;

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  var extend = function(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };

  // Set up inheritance for the model, collection, router, view and history.
  Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

  // Throw an error when a URL is needed, and none is supplied.
  var urlError = function() {
    throw new Error('A "url" property or function must be specified');
  };

  // Wrap an optional error callback with a fallback error event.
  var wrapError = function (model, options) {
    var error = options.error;
    options.error = function(resp) {
      if (error) error(model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };

}).call(this);

define("backbone", ["underscore"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Backbone;
    };
}(this)));

define('lib/uuid',[],function() {
	"use strict";

	// Returns a random v4 UUID of the form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, where each x is replaced with a
	// random hexadecimal digit from 0 to f, and y is replaced with a random hexadecimal digit from 8 to b.
	//
	// Source:	https://gist.github.com/LeverOne/1308368
	// License:	DO WTF YOU WANT TO PUBLIC LICENSE
	//
	// Copyright (C) 2011 Alexey Silin <pinkoblomingo@gmail.com>
	function uuid(
		a,b                // placeholders
	){
		for(               // loop :)
			b=a='';        // b - result , a - numeric variable
			a++<36;        //
			b+=a*51&52  // if "a" is not 9 or 14 or 19 or 24
				?  //  return a random number or 4
				(
					a^15      // if "a" is not 15
						?      // genetate a random number from 0 to 15
					8^Math.random()*
					(a^20?16:4)  // unless "a" is 20, in which case a random number from 8 to 11
						:
						4            //  otherwise 4
				).toString(16)
				:
				'-'            //  in other cases (if "a" is 9,14,19,24) insert "-"
		);
		return b
	}

	return {
		uuid: uuid
	};
});

/**
 * @class Http.Config
 * @singleton
 * @private
 *
 */

define('Http/Config',[],function() {
	"use strict";

	// 30s timeout for authentication
	var authenticationTimeout = 30000;

	// 120s timeout for operations that may require more time to complete
	var requestTimeout = 120000;

	// 120s timeout for uploading and downloading file attachments
	var attachmentTimeout = 120000;

	// 5s timeout for disconnecting from server
	var disconnectTimeout = 5000;

	return {
		/**
		 * @property {Number} authenticationTimeout=30000
		 * Timeout (ms) for authentication operation
		 */
		authenticationTimeout: authenticationTimeout,

		/**
		 * @property {Number} requestTimeout=120000
		 * Timeout (ms) for sync operations
		 */
		requestTimeout: requestTimeout,

		/**
		 * @property {Number} attachmentTimeout=120000
		 * Timeout (ms) for file attachment transfers
		 */
		attachmentTimeout: attachmentTimeout,

		/**
		 * @property {Number} disconnectTimeout=5000
		 * Timeout (ms) for disconnect operation
		 */
		disconnectTimeout: disconnectTimeout
	};
});
define('zepto',[
  "underscore"
], function(
  _
  ) {

  "use strict";

  /*
   * This version of Zepto was originally built from the 'zepto', 'event', and 'ajax' components,
   * but was stripped down to just contain the basic ajax component (no JSONP) support
   */

  /* Zepto 1.0rc1 - ajax - zeptojs.com/license */
  var Zepto = { };

  ;(function($){
    var jsonpID = 0,
        isObject = _.isObject,
        document = window.document,
        key,
        name,
        rscript = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        scriptTypeRE = /^(?:text|application)\/javascript/i,
        xmlTypeRE = /^(?:text|application)\/xml/i,
        jsonType = 'application/json',
        htmlType = 'text/html',
        blankRE = /^\s*$/

    function ajaxSuccess(data, xhr, settings) {
      var context = settings.context, status = 'success'
      settings.success.call(context, data, status, xhr)
      ajaxComplete(status, xhr, settings)
    }
    // type: "timeout", "error", "abort", "parsererror"
    function ajaxError(error, type, xhr, settings) {
      var context = settings.context
      settings.error.call(context, xhr, type, error)
      ajaxComplete(type, xhr, settings)
    }
    // status: "success", "notmodified", "error", "timeout", "abort", "parsererror"
    function ajaxComplete(status, xhr, settings) {
      var context = settings.context
      settings.complete.call(context, xhr, status)
    }

    // Empty function, used as default callback
    function empty() {}

    $.ajaxSettings = {
      // Default type of request
      type: 'GET',
      // Callback that is executed if the request succeeds
      success: empty,
      // Callback that is executed the the server drops error
      error: empty,
      // Callback that is executed on request complete (both: error and success)
      complete: empty,
      // The context for the callbacks
      context: null,
      // Transport
      xhr: function () {
        return new window.XMLHttpRequest()
      },
      // MIME types mapping
      accepts: {
        script: 'text/javascript, application/javascript',
        json:   jsonType,
        xml:    'application/xml, text/xml',
        html:   htmlType,
        text:   'text/plain'
      },
      // Whether the request is to another domain
      crossDomain: false,
      // Default timeout
      timeout: 0,
      // Whether data should be serialized to string
      processData: true
    }

    function mimeToDataType(mime) {
      return mime && ( mime == htmlType ? 'html' :
        mime == jsonType ? 'json' :
        scriptTypeRE.test(mime) ? 'script' :
        xmlTypeRE.test(mime) && 'xml' ) || 'text'
    }

    function appendQuery(url, query) {
      return (url + '&' + query).replace(/[&?]{1,2}/, '?')
    }

    // serialize payload and append it to the URL for GET requests
    function serializeData(options) {
      if (options.processData && isObject(options.data))
        options.data = $.param(options.data, options.traditional)
      if (options.data && (!options.type || options.type.toUpperCase() == 'GET'))
        options.url = appendQuery(options.url, options.data)
    }

    $.ajax = function(options){
      var settings = _.extend({}, options || {})
      for (key in $.ajaxSettings) if (settings[key] === undefined) settings[key] = $.ajaxSettings[key]

      if (!settings.crossDomain) settings.crossDomain = /^([\w-]+:)?\/\/([^\/]+)/.test(settings.url) &&
        RegExp.$2 != window.location.host

      var dataType = settings.dataType, hasPlaceholder = /=\?/.test(settings.url)

      if (!settings.url) settings.url = window.location.toString()
      serializeData(settings)

      var mime = settings.accepts[dataType],
          baseHeaders = { },
          protocol = /^([\w-]+:)\/\//.test(settings.url) ? RegExp.$1 : window.location.protocol,
          xhr = settings.xhr(), abortTimeout

      if (!settings.crossDomain) baseHeaders['X-Requested-With'] = 'XMLHttpRequest'
      if (mime) {
        baseHeaders['Accept'] = mime
        if (mime.indexOf(',') > -1) mime = mime.split(',', 2)[0]
        xhr.overrideMimeType && xhr.overrideMimeType(mime)
      }
      if (settings.contentType || (settings.contentType !== false && settings.data && settings.type.toUpperCase() != 'GET'))
        baseHeaders['Content-Type'] = (settings.contentType || 'application/x-www-form-urlencoded')
      settings.headers = _.extend(baseHeaders, settings.headers || {})

      xhr.onreadystatechange = function(){
        if (xhr.readyState == 4) {
          clearTimeout(abortTimeout)
          var result, error = false
          if ((xhr.status >= 200 && xhr.status < 300) || xhr.status == 304 || (xhr.status == 0 && protocol == 'file:')) {
          	dataType = dataType || mimeToDataType(xhr.getResponseHeader('content-type'))
            result = xhr.response

            try {
              if (dataType == 'script')    (1,eval)(result)
              else if (dataType == 'xml')  result = xhr.responseXML
              else if (dataType == 'json') result = blankRE.test(result) ? null : JSON.parse(result)
            } catch (e) { error = e }

            if (error) ajaxError(error, 'parsererror', xhr, settings)
            else ajaxSuccess(result, xhr, settings)
          } else {
            ajaxError(null, 'error', xhr, settings)
          }
        }
      }

      var async = 'async' in settings ? settings.async : true
      xhr.open(settings.type, settings.url, async)

      if (settings.responseType) xhr.responseType = settings.responseType

      for (name in settings.headers) xhr.setRequestHeader(name, settings.headers[name])

      if (settings.timeout > 0) abortTimeout = setTimeout(function(){
          xhr.onreadystatechange = empty
          xhr.abort()
          ajaxError(null, 'timeout', xhr, settings)
        }, settings.timeout)

      // avoid sending empty string (#319)
      xhr.send(settings.data ? settings.data : null)
      return xhr
    }

    $.get = function(url, success){ return $.ajax({ url: url, success: success }) }

    $.post = function(url, data, success, dataType){
      if (_.isFunction(data)) dataType = dataType || success, success = data, data = null
      return $.ajax({ type: 'POST', url: url, data: data, success: success, dataType: dataType })
    }

    $.getJSON = function(url, success){
      return $.ajax({ url: url, success: success, dataType: 'json' })
    }

    var escape = encodeURIComponent

    function serialize(params, obj, traditional, scope){
      var array = _.isArray(obj)
      _.each(obj, function(value, key) {
        if (scope) key = traditional ? scope : scope + '[' + (array ? '' : key) + ']'
        // handle data in serializeArray() format
        if (!scope && array) params.add(value.name, value.value)
        // recurse into nested objects
        else if (traditional ? _.isArray(value) : isObject(value))
          serialize(params, value, traditional, key)
        else params.add(key, value)
      })
    }

    $.param = function(obj, traditional){
      var params = []
      params.add = function(k, v){ this.push(escape(k) + '=' + escape(v)) }
      serialize(params, obj, traditional)
      return params.join('&').replace(/%20/g, '+')
    }
  })(Zepto)

  return Zepto;
});

define('Http/ajax',[
	"zepto",
	"underscore",
	"AH",
	"Constants"
], function (
	$,
	_,
	AH,
	Constants
	) {

	"use strict";

	return {
		ajax: function(options) {
			// Zepto doesn't include support for promises
			// so we must wrap its ajax implementation
			var dfd = AH.defer();

			_.extend(options, {
				success: function (data, status, xhr) {
					dfd.resolve({
						data: data,
						status: status,
						xhr: xhr
					});
				},

				error: function (response, errorType, exception) {
					var error = new Error(exception || response.statusText || errorType);

					// errorType can have the following values:
					// "error", "timeout", "abort", or "parsererror"
					switch (errorType) {
						case "timeout":
							error.message = "Request timed out";
							error.mdoCode = Constants.errorCodes.ajaxRequestTimeout;
							break;
						case "abort":
							error.message = "Request was aborted";
							error.mdoCode = Constants.errorCodes.ajaxRequestAbort;
							break;
						case "parsererror":
							error.message = "Cannot parse response";
							error.mdoCode = Constants.errorCodes.ajaxRequestParseError;
							break;
						case "error":
							error.message = (response.statusText || "Cannot access server") + " (Status: " + response.status + ")";
							error.httpStatus = response.status;
							error.mdoCode = Constants.errorCodes.ajaxRequestError;
							break;
						default:
							// Unknown error
							break;
					}

					return dfd.reject(error);
				}
			});

			$.ajax(options);

			return dfd.promise;
		},

		postJson: function(options) {
			_.extend(options, {
				type: "POST",
				contentType: "application/json; charset=utf-8",
				dataType: "json"
			});

			return this.ajax(options)
				.then(function (reply) {
					return reply.data;
				});
		}
	};
});
/**
 * @class Messages.Message
 *
 * Object used to pass information via notifications given by a {@link Promise Promise}.
 *
 * Accessed via {@link MDO.Client#Message}.
 *
 * #### Example:
 * If the message has a {@link Messages.Message#messageCode messageCode} of {@link Constants.MessageCode#applyingServerChanges applyingServerChanges}, the {@link Messages.Message#args args} will contain the current change being applied and the total number of changes.
 *
 *     mdoCon.sync().then(null, null, function(message) {
 *         if(message.messageCode == Constants#messageCodes.{@link Constants.MessageCode#applyingServerChanges applyingServerChanges}) {
 *             alert('Applying server change ' + message.args[0] + 'of' + message.args[1]);
 *         }
 *     });
 */

define('Messages/Message',[
	"underscore",
	"Constants",
	"AH"
], function (
	_,
	Constants,
	AH
	) {

	"use strict";

	var defaultMessages = {};
	var overrideMessages = {};
	
	defaultMessages[Constants.messageCodes.applyingServerChanges] = "Applying server change {0} of {1}";
	defaultMessages[Constants.messageCodes.preparingUpload] = "Preparing upload";
	defaultMessages[Constants.messageCodes.extractingFile] = "Extracting file {0} of {1}";
	defaultMessages[Constants.messageCodes.resettingDatabase] = "Resetting database";
	defaultMessages[Constants.messageCodes.deployingDatabase] = "Deploying database";
	defaultMessages[Constants.messageCodes.uploadingFile] = "Uploading file {0} of {1}";
	defaultMessages[Constants.messageCodes.downloadingFile] = "Downloading file {0} of {1}";
	defaultMessages[Constants.messageCodes.downloadingSegment] = "Downloading segment {0} of {1}";
	defaultMessages[Constants.messageCodes.checkingForAttachmentUploads] = "Checking for attachments to upload";
	defaultMessages[Constants.messageCodes.checkingForAttachmentDownloads] = "Checking for attachments to download";
	defaultMessages[Constants.messageCodes.downloadingVaultFile] = "Downloading {0} of {1}: '{2}'";
	defaultMessages[Constants.messageCodes.downloadingVaultFiles] = "Downloading {0} attachment(s)";
	defaultMessages[Constants.messageCodes.uploadingVaultFile] = "Uploading {0} of {1}: '{2}'";
	defaultMessages[Constants.messageCodes.uploadingVaultFiles] = "Uploading {0} attachment(s)";
	defaultMessages[Constants.messageCodes.authenticating] = "Authenticating";
	defaultMessages[Constants.messageCodes.disconnecting] = "Disconnecting";
	defaultMessages[Constants.messageCodes.requestingFiles] = "Requesting Files";
	defaultMessages[Constants.messageCodes.registeringDevice] = "Registering device";


	function Message(defaultMessage, messageCode) {
		var args = arguments;
		/**
		@property {string} messageCode
		@readonly

		{@link Constants.MessageCode MessageCode} indicating the value of this message.
		*/
		Object.defineProperty(this, "messageCode", {
			get: function () { return messageCode; }
		});

		/**
		@property {string} message
		@readonly

		Formatted message relating to messageCode.
		*/
		Object.defineProperty(this, "message", {
			get: function () {
				var formatArgs = [defaultMessage].concat(this.args);
				return AH.format.apply(undefined, formatArgs);
			}
		});

		/**
		@property {Array} args
		@readonly

		Arguments given to this message for formatting the message.

		## Usage

			mdoCon.sync().then(null, null, function(message) {
					if(message.messageCode == Constants#messageCodes.{@link Constants.MessageCode#uploadingFile uploadingFile}) {
						alert('Uploading file' + message.args[0] + 'of' + message.args[1]);
					}
				});

		*/
		Object.defineProperty(this, "args", {
			get: function () {
				return Array.prototype.slice.call(args, 2);
			}
		});
	}


	/**
	@method toString
	Converts the Message to a string

	@returns {string}
	returns the default string value of this message
	*/
	Message.prototype.toString = function () {
		return this.message;
	};

	/**
	@method overrideMessages
	Takes a config object used to override the default message properties of Message objects.
	Values not provided by the config will retain their {@link Constants.MessageCode default} values.
	Successive calls to overrideMessages will clear previous overrides.

	@static

	@param {Object} config
	String values to use in place of default messages

	##Example

		var config = {};
		config[Constants#messageCodes.{@link Constants.MessageCode#applyingServerChanges applyingServerChanges}] = "Aplicando el cambio de servidor: {0} de los {1}"

		mdo.Message.overrideMessages(config);

		...

		connection.{@link MDO.Connection#sync sync}().then(null, null, function(message) {
			if(message.messageCode == Constants#messageCodes.{@link Constants.MessageCode#applyingServerChanges applyingServerChanges}) {
				assert.equal(message.message, "Aplicando el cambio de servidor: " + message.args[0] + "de los" + message.args[1]);
			}
		});
	*/
	Message.overrideMessages = function (config) {
		overrideMessages = {};
		_.extend(overrideMessages, config);
	};


	//
	// @method getMessage
	//
	// @static
	//
	// @param {Constants.MessageCode} messageCode
	//
	// @param {string/number...} [args]
	//
	// arguments to apply to formatting with the default message
	//
	Message.getMessage = function (messageCode) {
		var factoryArgs = Array.prototype.slice.call(arguments, 1);
		factoryArgs.splice(0, 0, Message, undefined, overrideMessages[messageCode] || defaultMessages[messageCode] || "[" + messageCode + "]", messageCode);
		var FactoryFunc = bindWithCtorSupport.apply(undefined, factoryArgs);
		return new FactoryFunc();
	};

	// MAGIC BLUE SMOKE - Work around for the case where Function.prototype.bind is not defined
	//
	// Underscore.js does provide an implementation for this case, however their solution is
	// insufficient when binding to a constructor. This work around allows us to bind to message's
	// constructor in our getMessage factory method.
	function bindWithCtorSupport(func, context) {
		var bind = Function.prototype.bind
			|| function (instance) {
				if (typeof this !== "function") {
					// closest thing possible to the ECMAScript 5 internal IsCallable function
					throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
				}

				var args = Array.prototype.slice.call(arguments, 1),
					self = this;

				function NOP() {}
				function Bound() {
					return self.apply(this instanceof NOP && !instance ? this : instance,
						args.concat(Array.prototype.slice.call(arguments)));
				}

				NOP.prototype = this.prototype;
				Bound.prototype = new NOP();

				return Bound;
			};
		return bind.apply(func, Array.prototype.slice.call(arguments, 1));
	}

	return Message;

});
define('Http/Server',[
	"./ajax",
	"./Config",
	"underscore",
	"AH",
	"Messages/Message",
	"Constants"
], function (
	ajax,
	HttpConfig,
	_,
	AH,
	Message,
	Constants
	) {

	"use strict";

	/**
	 * @class Http.Server
	 * @private
	 *
	 */

	/**
	 * @constructor
	 *
	 * @param {string} url
	 * base url to make requests against
	 *
	 * @param {Function} credentialsCallback
	 * function that returns an object containing the information required to authenticate
	 *
	 * @param {Object.<string, string>} credentialsCallback.return
	 * Object containing information required to connect to the server. Object should contain either
	 * domainId and userId or user and domain.
	 *
	 * @param {string} [credentialsCallback.return.domainId]
	 * Stringified GUID for the domain
	 *
	 * @param {boolean} [credentialsCallback.return.deviceSharing]
	 * If true, Http.Server expects that deviceSharing is turned on
	 *
	 * @param {string} [credentialsCallback.return.userId]
	 * Stringified GUID for the user
	 *
	 * @param {string} [credentialsCallback.return.user]
	 * User's name
	 *
	 * @param {string} [credentialsCallback.return.domain]
	 * Domain's name
	 *
	 * @param {string} [credentialsCallback.return.password]
	 */
	return function (url, credentialsCallback) {

		// Stores the authentication token returned by the server in response to an 'authenticate' request
		// format: {sessionId: <sessionId>, domainId: <domain GUID>, userId: <user GUID>}
		var authToken;

		// Stores the mailbox id of the file that should be acknowledged as part of the next request
		var fileToAcknowledge = null;

		/**
		* @method buildAuthenticatedRequest
		* @private
		* Appends additional info to a request (sessionId, userId, file acknowledgement...)
		*/
		function buildAuthenticatedRequest(request) {
			if (!authToken) {
				var err = new Error("A call to 'authenticate' is required before the request can be made");
				err.mdoCode = Constants.errorCodes.authTokenRequired;
				throw err;
			}
			request = request || { };
			_.extend(request, authToken);

			if (fileToAcknowledge) {
				request.fileAck = fileToAcknowledge;
			}

			return request;
		}

		/**
		* @method postJson
		* @private
		* Helper method for performing a POST with JSON data.  Returns an AH deferred promise
		*/
		function postJson(route, data, options) {
			// NOTE: Would need to read out the DSS location from local storage for cross-domain posts
			if (url) {
				route = url + route;
			}

			var settings = _.extend({
				data: data,
				url: route,
				headers: {
					// iOS 6 caches POST requests unless they
					// explicitly specify that they shouldn't be cached
					"Cache-Control": "no-cache"
				}
			}, options);

			return ajax.postJson(settings)
				.then(filterHttpResponse);

			function filterHttpResponse(response) {
				if (!response.error) {
					fileToAcknowledge = null;
					return response;
				}

				var error = new Error(response.error);
				if (response.errorCode) {
					error.mdoCode = response.errorCode;
				}
				_.extend(error, response, { error: undefined, errorCode: undefined });
				return AH.reject(error);
			}
		}

		/**
		 * @method authenticate
		 * @private
		 * Performs a JSON POST to the AuthenticationHandler.
		 * First-Time request format: {domain: domain name, user: user name, password: user password}
		 * Id-based request format: {domainId: domain GUID, userId:user GUID, password: user password}
		 *
		 * @param {Object.<string, string>} credentials
		 *
		 * @param {string} [credentials.domainId]
		 * Stringified GUID
		 *
		 * @param {boolean} [credentials.deviceSharing]
		 *
		 * @param {string} [credentials.userId]
		 * Stringified GUID
		 *
		 * @param {string} [credentials.user]
		 *
		 * @param {string} [credentials.domain]
		 *
		 * @param {string} [credentials.password]
		 *
		 * @param {number} [timeout=30000]
		 * Duration in milliseconds to wait before Server considers the request to have timedout.
		 */

		function authenticate(credentials, timeout) {
			return AH.deferredTryCatch(function() {
				// validate credentials fields (see also AuthenticationRequest.cs)
				var isValid;
				if (credentials.deviceSharing) {
					isValid = (credentials.domainId && credentials.userId && credentials.user);
				} else {
					isValid = (credentials.domainId && credentials.userId) || (credentials.domain && credentials.user);
				}
				if (!isValid) {
					throw new Error("Invalid credentials format");
				}

				var promise = postJson("Authenticate", JSON.stringify(credentials), { timeout: timeout || HttpConfig.authenticationTimeout });
				promise.then(function(reply) {
					authToken = reply;
				});

				return AH.notify(Message.getMessage(Constants.messageCodes.authenticating), promise);
			});
		}

		/**
		 * @method query
		 *
		 * Performs a JSON Post to the Domain and Class handler for queries.
		 *
		 * @param {Object.<string,string|Object>} request
		 * Route information and Query options
		 *
		 * @param {string} request.className
		 * Name of the class to query against
		 *
		 * @param {string} request.dataStoreId
		 * GUID of the DataStore to query against
		 *
		 * @param {Object.<string, string|number|Array>} [request.queryOptions]
		 * Optional parameters to the query that are used to limit the results
		 *
		 * @param {string|Object.<string,string|number>} [request.queryOptions.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [request.queryOptions.filterParams]
		 * values used to complete parameterized filter
		 *
		 * @param {number} [request.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [request.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array.<string>} [request.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @param {boolean} [request.queryOptions.countOnly]
		 * If true, only return the count value.
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 *
		 * @return {Promise.<Object>}
		 *
		 * @return {Array} return.rows
		 * Array of Lookups containing field/value pairs.
		 */
		function query(request, timeout) {
			return AH.deferredTryCatch(getAuthToken).then(doQuery);

			function getAuthToken() {
				return AH.resolve(buildAuthenticatedRequest(request.queryOptions));
			}

			function doQuery(authenticatedRequest) {
				// validate request fields
				if ((!request.dataStoreId || !request.className)) {
					throw new Error("Invalid request format");
				}

				return postJson(AH.format("Data/{0}/{1}", request.dataStoreId, request.className),
					JSON.stringify(authenticatedRequest || {}), {
						timeout: timeout || HttpConfig.requestTimeout
					});
			}
		}

		/**
		 * @method disconnect
		 * @private
		 * Performs a JSON POST to the DisconnectHandler to end the current data sync session
		 *
		 * @param {number} [timeout=5000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */

		function disconnect(timeout) {
			return AH.deferredTryCatch(function () {
				var request = buildAuthenticatedRequest();
				var currentAuthToken = authToken;

				var promise = postJson("Disconnect", JSON.stringify(request), {
					timeout: timeout || HttpConfig.disconnectTimeout
				});
				promise.then(function() {
					if (authToken === currentAuthToken) {
						authToken = null;
					}
				});

				return AH.notify(Message.getMessage(Constants.messageCodes.disconnecting), promise);
			});
		}

		/**
		 * @method getFileList
		 * Performs a JSON POST to the FileManifestHandler to retrieve a list of files that are
		 * available in the authenticated user's Post Office
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */

		function getFileList(timeout) {
			return AH.deferredTryCatch(function () {
				var request = buildAuthenticatedRequest();
				var promise = postJson("Manifest", JSON.stringify(request), {
					timeout: timeout || HttpConfig.requestTimeout
				});
				return AH.notify(Message.getMessage(Constants.messageCodes.requestingFiles), promise);
			});
		}

		/**
		 * @method getFile
		 * Performs a JSON POST to the FileDownloadHandler to retrieve a MTL or MDM file from the
		 * current user's post office
		 *
		 * @param fileDescriptor
		 *
		 *
		 * @param {Object} options
		 *
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */
		function getFile(fileDescriptor, options, timeout) {
			return AH.deferredTryCatch(function () {
				if (!fileDescriptor) {
					throw new Error("file is required for file download requests");
				}

				var request = buildAuthenticatedRequest(_.extend({ file: fileDescriptor }, options));
				return postJson("Download", JSON.stringify(request), {
					timeout: timeout || HttpConfig.requestTimeout
				});
			});
		}

		/**
		 * @method getSegment
		 * Performs a JSON POST to the SegmentDownloadHandler to retrieve an MTL segment
		 *
		 * @param segmentInfo
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */
		function getSegment(segmentInfo, timeout) {
			return AH.deferredTryCatch(function () {
				
				if (!segmentInfo) {
					throw new Error("segmentInfo is required for segment download requests");
				}

				var propNames = "mailboxId segmentFileName segmentFileType segmentIndex".split(" ");
				segmentInfo = _.pick(segmentInfo, propNames);
				// Validate segmentInfo
				_.forEach(propNames, function(prop) {
					if (_.isUndefined(segmentInfo[prop])) {
						throw new Error(prop + " is required for segment download requests");
					}
				});
				var request = buildAuthenticatedRequest(segmentInfo);
				return postJson("DownloadSegment", JSON.stringify(request), {
					timeout: timeout || HttpConfig.requestTimeout
				});
			});
		}

		/**
		 * @method putFile
		 * Performs a JSON POST to the FileUploadHandler to save an outgoing MTC to the post office
		 *
		 * @param mtc
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */
		function putFile(mtc, timeout) {
			return AH.deferredTryCatch(function() {
				var request = buildAuthenticatedRequest(mtc);
				return postJson("Upload", JSON.stringify(request), {
					timeout: timeout || HttpConfig.requestTimeout
				});
			});
		}

		/**
		 * @method execute
		 * Performs a JSON POST to the Execute/method handler
		 *
		 * @param method
		 *
		 * Name of remote method to execute, e.g. "RegisterDevice"
		 *
		 * @param data
		 *
		 * Request payload for the remote method
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 */
		function execute(method, data, timeout) {
			if (!method || !data) {
				var err = new Error("Missing required parameters.");
				err.mdoCode = Constants.errorCodes.invalidArgs;
				return AH.reject(err);
			}
			if (authToken) {
				data = buildAuthenticatedRequest(data);
			}
			return postJson("Execute/" + method, JSON.stringify(data), {
				timeout: timeout || HttpConfig.requestTimeout
			});
		}

		var sessions = [], authPromise;

		/**
		 * @method session
		 * Executes a callback within a server authenticated session
		 * then disconnects
		 *
		 * @param {Function=} callback
		 * Takes an Http.Server, the authentication response, executes actions on the server, and
		 * returns a promise
		 *
		 * @param {Http.Server} callback.server
		 * The calling server
		 *
		 * @param {Object} callback.authResponse
		 * Object representing the response from the authentication attempt
		 *
		 * @param {Promise} callback.return
		 *
		 * @param {number} [authTimeout=30000]
		 * Duration in milliseconds to wait before Server considers the authentication or disconnect request to have
		 * timed out.
		 *
		 * @return {Promise}
		 * Settles with the same error or value as the callback's returned promise.
		 */
		function session(callback, authTimeout) {
			callback = callback ? _.partial(callback, this) : callback;
			authPromise = authPromise || AH.deferredTryCatch(function () {
				return authenticate(credentialsCallback(), authTimeout);
			});
			var promise = authPromise.then(function (authReply) {
				return validateCallbackReturn(callback, authReply);
			});

			return promise.then(function(value) {
				return executeSessionDisconnect(false, value);
			}, function (err) {
				return executeSessionDisconnect(true, err);
			});
		}

		/**
		 * @method validateCallbackReturn
		 * @private
		 * Checks the return value of the callback. If it is a promise, add
		 * it to the sessions queue. otherwise, reject.
		 *
		 *
		 * @param {Function} callback
		 * Function to call. If the call fails due to authentication token,
		 * authenticate, then try again. Any remaining parameters will
		 * be passed to the callback.
		 *
		 * @param {Promise} callback.return
		 *
		 * @param callbackArg
		 * First argument to invoke the callback with
		 *
		 * @return {Promise}
		 */
		function validateCallbackReturn(callback, callbackArg) {
			var promise;
			if (callback) {
				promise = callback(callbackArg);
				if (!promise || !_.isObject(promise) || !_.isFunction(promise.then)) {
					promise = AH.reject(new Error("Session callback did not return a promise."));
				} else {
					promise = addSession(promise);
				}
			}
			return promise;
		}

		/**
		 * @method addSession
		 * @private
		 *
		 * @param {Promise} promise
		 * Promise to add to the sessions list.
		 *
		 * @return {Promise}
		 */
		function addSession(promise) {
			sessions.push(promise);
			return promise.then(function (value) {
				removeSession(promise);
				return AH.resolve(value);
			}, function (error) {
				removeSession(promise);
				return AH.reject(error);
			});
		}

		/**
		 * @method removeSession
		 * @private
		 * Remove the given promise from the sessions list
		 *
		 * @param {Promise} promise
		 * promise representing a session
		 */
		function removeSession(promise) {
			sessions.splice(sessions.indexOf(promise), 1);
		}

		/**
		 * @method executeSessionDisconnect
		 * @private
		 * Call disconnect if the sessions queue is empty, then resolve or
		 * reject with the original value.
		 *
		 * @param {boolean} isRejecting
		 * True if the promise should reject
		 *
		 * @param valueOrError
		 * Value or Error to reject or resolve with
		 *
		 * @param {number} [timeout=5000]
		 * Duration in milliseconds to wait before Server considers the request to have timed out.
		 *
		 * @return {Promise}
		 * if isRejecting is true, returns a Promise that rejects with the valueOrError.
		 * otherwise, returns a Promise that resolves with the valueOrError.
		 */
		function executeSessionDisconnect (isRejecting, valueOrError, timeout) {
			if (!sessions.length) {
				authPromise = null;
				return disconnect(timeout).always(function () {
					return resolveOrReject(isRejecting, valueOrError);
				});
			}

			return resolveOrReject(isRejecting, valueOrError);
		}

		/**
		 * @method resolveOrReject
		 * @private
		 *
		 * @param {boolean} reject
		 * True if the promise should reject
		 *
		 * @param valueOrError
		 * Value or Error to reject or resolve with
		 *
		 * @return {Promise}
		 * if isRejecting is true, returns a Promise that rejects with the valueOrError.
		 * otherwise, returns a Promise that resolves with the valueOrError.
		 */
		function resolveOrReject(reject, valueOrError) {
			return reject ? AH.reject(valueOrError) : AH.resolve(valueOrError);
		}

		/**
		 * @method authenticateOnFailure
		 * @private
		 *
		 * @param {Function} callback
		 * Function to call. If the call fails due to authentication token,
		 * authenticate, then try again. Any remaining parameters will
		 * be passed to the callback.
		 *
		 * @param callback.args*
		 * callback may take any number or type of arguments
		 *
		 * @param {Promise} callback.return
		 *
		 * @return {Promise}
		 */
		function authenticateOnFailure(callback) {
			var callbackArgs = Array.prototype.slice.call(arguments, 1);
			var errorCodes = Constants.errorCodes;
			return callback.apply(this, callbackArgs)
				.then(undefined, function (err) {
					if (err.mdoCode === errorCodes.authTokenRequired
						|| err.mdoCode === errorCodes.invalidSessionId) {
						return authenticate(credentialsCallback())
							.then(function () {
								return callback.apply(this, callbackArgs);
							});
					}
					return AH.reject(err);
				})
				.then(function(value) {
					return executeSessionDisconnect(false, value);
				}, function (err) {
					return executeSessionDisconnect(true, err);
				});
		}

		return {
			query: _.partial(authenticateOnFailure, query),
			getFileList: _.partial(authenticateOnFailure, getFileList),
			getFile: _.partial(authenticateOnFailure, getFile),
			getSegment: _.partial(authenticateOnFailure, getSegment),
			putFile: _.partial(authenticateOnFailure, putFile),
			execute: execute,
			session: session,
			set fileToAcknowledge(val) {
				if (fileToAcknowledge) {
					throw new Error("Cannot overwrite file acknowledgement (fileToAcknowledge).");
				}

				fileToAcknowledge = val;
			},
			get fileToAcknowledge() {
				return fileToAcknowledge;
			}
		};

	};

});
// Class
// Extensible class, a la Backbone.Model
define('lib/Class',[
	"underscore",
	"backbone"
], function(
	_,
	Backbone
	) {

	"use strict";

	var Class = function() {
		this.initialize.apply(this, arguments);
	};

	_.extend(Class.prototype, {
		initialize: function() {
			// Noop
		}
	});

	Class.extend = Backbone.Model.extend;

	return Class;
});
define('LocalStorage/Storage',[
	"underscore",
	"lib/Class"
], function (
	_,
	Class
	) {

	"use strict";

	return Class.extend({

		// ## new Storage(key, properties, quickProperties, defaults)
		//
		// Creates a localStorage object that has setter and getter methods
		// based on strings in `properties` and `quickProperties`.
		//
		// * properties are stored as object properties in localStorage[key]
		// * quickProperties are stored as individual localStorage[key + "." + quickProperty] entries
		// * defaults specifies the default values for both `properties` and `quickProperties` (e.g. { key: defaultValue })
		//
		initialize: function (key, properties, quickProperties, defaults) {
			var settings = {};
			defaults = defaults || {};

			this.settings = {};
			this.key = key;
			this.quickProperties = quickProperties;

			load();

			if (properties) {
				_.each(properties, function (prop) {
					this[prop] = makeAccessor(prop);
				}, this);
			}

			if (quickProperties) {
				_.each(quickProperties, function (prop) {
					this[prop] = makeQuickAccessor(prop);
				}, this);
			}

			function makeAccessor(name) {
				return function (value) {
					return item(name, value);
				};
			}

			function makeQuickAccessor(name) {
				return function (value) {
					return quickItem(name, value);
				};
			}

			function item(property, value) {
				if (value !== undefined) {
					settings[property] = (value === null) ? undefined : value;
					save();
				}

				return _.isUndefined(settings[property]) ? getDefaultValueOrNull(property) : settings[property];
			}

			function quickItem(name, value) {
				var propertyKey = key + "." + name;
				if (value !== undefined) {
					if (value === null) {
						localStorage.removeItem(propertyKey);
					} else {
						localStorage.setItem(propertyKey, JSON.stringify(value));
					}
				}


				return (propertyKey in localStorage)
					? JSON.parse(localStorage.getItem(propertyKey))
					: getDefaultValueOrNull(name);
			}

			function getDefaultValueOrNull(name) {
				return _.isUndefined(defaults[name]) ? null : defaults[name];
			}

			function load() {
				settings = (key in localStorage)
					? JSON.parse(localStorage.getItem(key))
					: {};
			}

			function save() {
				localStorage.setItem(key, JSON.stringify(settings));
			}
		},

		// ## storage.remove()
		//
		// Removes localStorage entries associated with this object
		//
		remove: function () {
			var key = this.key;
			localStorage.removeItem(key);
			if (this.quickProperties) {
				_.each(this.quickProperties, function (name) {
					localStorage.removeItem(key + "." + name);
				}, this);
			}
			this.settings = {};
		}

	});
});
define('LocalStorage/Datastore',[
	"./Storage",
	"AH"
], function (Storage, AH) {
	"use strict";

	var datastoreCache = {};

	// ## datastoreKey()
	//
	// Returns the Storage key based on the `datastoreId`
	//
	function datastoreKey(datastoreId) {
		return "@datastore_" + datastoreId;
	}

	function buildDirectory(datastoreId) {
		return "/Datastores/" + datastoreId + "/";
	}

	function buildIncomingDir(datastoreId) {
		return buildDirectory(datastoreId) + "Incoming/";
	}

	// # Datastore class
	//
	// * id
	// * name
	// * modelId
	// * modelVersion
	// * inSeriesId
	// * outSeriesId
	// * inSeqNum
	// * outSeqNum
	// * nextTempId
	//
	/**
	 * @class LocalStorage.DataStore
	 * @private
	 * LocalStorage for information pertaining to a MDO.DataStore
	 */
	var Datastore = Storage.extend({
		initialize: function (datastoreId) {
			Storage.prototype.initialize.call(this, datastoreKey(datastoreId),
				["id", "name", "modelId", "modelVersion", "inSeriesId", "outSeriesId"],
				["inSeqNum", "outSeqNum", "nextTempId"]);

		},

		// ## ds.remove()
		//
		// Removes the data store settings
		//
		remove: function () {
			var datastoreId = this.id();
			delete datastoreCache[datastoreId];
			Storage.prototype.remove.call(this);
		},

		// ## ds.generateNextTempId()
		//
		// Decrements the nextTempId and returns its new value.
		//
		generateNextTempId: function () {
			return this.nextTempId(this.nextTempId() - 1);
		},

		// ## ds.directory()
		//
		// Returns path to datastore's directory
		//
		directory: function () {
			return buildDirectory(this.id());
		},

		// ## ds.modelPath()
		//
		// Returns path to datastore's model file
		//
		modelPath: function () {
			return this.directory() + this.id() + ".mdm";
		},

		// ## ds.incomingDir()
		//
		// Returns path to datastore's **Incoming** directory
		//
		// This diretory contains data sync MTLs that have been downloaded from the server
		// and are about to be applied (or moved to Pending)
		//
		incomingDir: function () {
			return buildIncomingDir(this.id());
		},

		// ## ds.dbName()
		//
		// Returns name of database
		//
		dbName: function () {
			return this.id();
		}
	});

	// ## Datastore.create(datastoreId)
	//
	// Creates a data store settings instance with the specified ID
	//
	Datastore.create = function (datastoreId) {
		var ds = new Datastore(datastoreId);
		ds.id(datastoreId);
		datastoreCache[datastoreId] = ds;
		return ds;
	};

	// ## Datastore.retrieve(datastoreId)
	//
	// Retrieves the data store with the specified datastoreId.
	// Returns `undefined` if data store setting doesn't exist
	//
	Datastore.retrieve = function (datastoreId) {
		var ds = datastoreCache[datastoreId];

		if (!ds) {
			ds = new Datastore(datastoreId);
			if (!ds.id()) {
				return undefined;
			}
			datastoreCache[datastoreId] = ds;
		}
		return ds;
	};

	// ## Datastore.getIncomingDir(datastoreId)
	//
	// Returns the path to the datastore's 'Incoming' directory
	//
	Datastore.getIncomingDir = buildIncomingDir;

	// ## Datastore.getDirectory(datastoreId)
	//
	// Returns the path to the datastore's base directory
	//
	Datastore.getDirectory = buildDirectory;

	// ## MdoDatastore.reset()
	//
	// Reset datastore cache (used by Unit Tests)
	//
	Datastore.reset = function() {
		datastoreCache = { };
	};

	return Datastore;
});
/* Module based on utf8 encode and decode from Chris Veness' SHA-1 implementation*/

/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */
/*  SHA-1 implementation in JavaScript | (c) Chris Veness 2002-2010 | www.movable-type.co.uk      */
/*   - see http://csrc.nist.gov/groups/ST/toolkit/secure_hashing.html                             */
/*         http://csrc.nist.gov/groups/ST/toolkit/examples.html                                   */
/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */

define('lib/utf8',[], function () {
	function encode(strUni) {
		// use regular expressions & String.replace callback function for better efficiency 
		// than procedural approaches
		var strUtf = strUni.replace(
			/[\u0080-\u07ff]/g, // U+0080 - U+07FF => 2 bytes 110yyyyy, 10zzzzzz
			function (c) {
				var cc = c.charCodeAt(0);
				return String.fromCharCode(0xc0 | cc >> 6, 0x80 | cc & 0x3f);
			}
		);
		strUtf = strUtf.replace(
			/[\u0800-\uffff]/g, // U+0800 - U+FFFF => 3 bytes 1110xxxx, 10yyyyyy, 10zzzzzz
			function (c) {
				var cc = c.charCodeAt(0);
				return String.fromCharCode(0xe0 | cc >> 12, 0x80 | cc >> 6 & 0x3F, 0x80 | cc & 0x3f);
			}
		);
		return strUtf;
	};

	/**
	* Decode utf-8 encoded string back into multi-byte Unicode characters
	*
	* @param {String} strUtf UTF-8 string to be decoded back to Unicode
	* @returns {String} decoded string
	*/
	function decode(strUtf) {
		// note: decode 3-byte chars first as decoded 2-byte strings could appear to be 3-byte char!
		var strUni = strUtf.replace(
			/[\u00e0-\u00ef][\u0080-\u00bf][\u0080-\u00bf]/g, // 3-byte chars
			function (c) { // (note parentheses for precence)
				var cc = ((c.charCodeAt(0) & 0x0f) << 12) | ((c.charCodeAt(1) & 0x3f) << 6) | (c.charCodeAt(2) & 0x3f);
				return String.fromCharCode(cc);
			}
		);
		strUni = strUni.replace(
			/[\u00c0-\u00df][\u0080-\u00bf]/g, // 2-byte chars
			function (c) { // (note parentheses for precence)
				var cc = (c.charCodeAt(0) & 0x1f) << 6 | c.charCodeAt(1) & 0x3f;
				return String.fromCharCode(cc);
			}
		);
		return strUni;
	};

	return {
		encode: encode,
		decode: decode
	};
});
/* Module based on Chris Veness' SHA-1 implementation*/

/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */
/*  SHA-1 implementation in JavaScript | (c) Chris Veness 2002-2010 | www.movable-type.co.uk      */
/*   - see http://csrc.nist.gov/groups/ST/toolkit/secure_hashing.html                             */
/*         http://csrc.nist.gov/groups/ST/toolkit/examples.html                                   */
/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  */

define('lib/encryption',["./utf8"], function (Utf8) {

	var h0 = 0x67452301;
	var h1 = 0xEFCDAB89;
	var h2 = 0x98BADCFE;
	var h3 = 0x10325476;
	var h4 = 0xC3D2E1F0;



	function sha1(msg, utf8encode) {
		utf8encode = (typeof utf8encode == 'undefined') ? true : utf8encode;

		// convert string to UTF-8, as SHA only deals with byte-streams
		if (utf8encode) msg = Utf8.encode(msg);

		// constants [§4.2.1]
		var Kconstants = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

		// PREPROCESSING 

		msg += String.fromCharCode(0x80);  // add trailing '1' bit (+ 0's padding) to string [§5.1.1]

		// convert string msg into 512-bit/16-integer blocks arrays of ints [§5.2.1]
		var length = msg.length / 4 + 2;  // length (in 32-bit integers) of msg + ‘1’ + appended length
		var numBlocks = Math.ceil(length / 16);   // number of 16-integer-blocks required to hold 'length' ints.
		var msgBits = new Array(numBlocks);

		for (var i = 0; i < numBlocks; i++) {
			msgBits[i] = new Array(16);
			for (var j = 0; j < 16; j++) {  // encode 4 chars per integer, big-endian encoding
				msgBits[i][j] = (msg.charCodeAt(i * 64 + j * 4) << 24) | (msg.charCodeAt(i * 64 + j * 4 + 1) << 16) |
        (msg.charCodeAt(i * 64 + j * 4 + 2) << 8) | (msg.charCodeAt(i * 64 + j * 4 + 3));
			} // note running off the end of msg is ok as bitwise ops on NaN return 0
		}
		// add length (in bits) into final pair of 32-bit integers (big-endian) [§5.1.1]
		// note: most significant word would be (len-1)*8 >>> 32, but since JS converts
		// bitwise-op args to 32 bits, we need to simulate this by arithmetic operators
		msgBits[numBlocks - 1][14] = ((msg.length - 1) * 8) / Math.pow(2, 32); msgBits[numBlocks - 1][14] = Math.floor(msgBits[numBlocks - 1][14])
		msgBits[numBlocks - 1][15] = ((msg.length - 1) * 8) & 0xffffffff;

		// set initial hash value [§5.3.1]
		var H0 = 0x67452301;
		var H1 = 0xefcdab89;
		var H2 = 0x98badcfe;
		var H3 = 0x10325476;
		var H4 = 0xc3d2e1f0;

		// HASH COMPUTATION [§6.1.2]

		var extendedChunk = new Array(80); var a, b, c, d, e;
		for (var i = 0; i < numBlocks; i++) {

			// 1 - prepare message schedule 'W'
			for (var t = 0; t < 16; t++) extendedChunk[t] = msgBits[i][t];
			for (var t = 16; t < 80; t++) extendedChunk[t] = rotL(extendedChunk[t - 3] ^ extendedChunk[t - 8] ^ extendedChunk[t - 14] ^ extendedChunk[t - 16], 1);

			// 2 - initialise five working variables a, b, c, d, e with previous hash value
			a = H0; b = H1; c = H2; d = H3; e = H4;

			// 3 - main loop
			for (var t = 0; t < 80; t++) {
				var s = Math.floor(t / 20); // seq for blocks of 'f' functions and 'K' constants
				var T = (rotL(a, 5) + f(s, b, c, d) + e + Kconstants[s] + extendedChunk[t]) & 0xffffffff;
				e = d;
				d = c;
				c = rotL(b, 30);
				b = a;
				a = T;
			}

			// 4 - compute the new intermediate hash value
			H0 = (H0 + a) & 0xffffffff;  // note 'addition modulo 2^32'
			H1 = (H1 + b) & 0xffffffff;
			H2 = (H2 + c) & 0xffffffff;
			H3 = (H3 + d) & 0xffffffff;
			H4 = (H4 + e) & 0xffffffff;
		}

		return toHexStr(H0) + toHexStr(H1) +
    toHexStr(H2) + toHexStr(H3) + toHexStr(H4);
	}

	//
	// function 'f' [§4.1.1]
	//
	function f(s, x, y, z) {
		switch (s) {
			case 0: return (x & y) ^ (~x & z);           // Ch()
			case 1: return x ^ y ^ z;                    // Parity()
			case 2: return (x & y) ^ (x & z) ^ (y & z);  // Maj()
			case 3: return x ^ y ^ z;                    // Parity()
		}
	}

	//
	// rotate left (circular left shift) value x by n positions [§3.2.5]
	//
	function rotL(x, n) {
		return (x << n) | (x >>> (32 - n));
	}

	//
	// hexadecimal representation of a number 
	//   (note toString(16) is implementation-dependant, and  
	//   in IE returns signed numbers when used on full words)
	//
	function toHexStr(n) {
		var s = "", v;
		for (var i = 7; i >= 0; i--) {
			v = (n >>> (i * 4)) & 0xf;
			s += v.toString(16);
		}
		return s.toUpperCase();
	}

	return {
		sha1: sha1
	};
});
define('LocalStorage/Domain',[
	"underscore",
	"./Datastore",
	"./Storage",
	"lib/encryption",
	"AH"
], function (
	_,
	DatastoreInfo,
	Storage,
	Encryption,
	AH
	) {

	"use strict";

	var cachedDomain;

	// # Domain class
	//
	// * name
	// * id
	// * user
	// * userId
	// * passwordHash
	// * dataStoreIds
	//
	var Domain = Storage.extend({
		initialize: function () {
			Storage.prototype.initialize.call(this, "@domain",
				["name", "id", "user", "userId", "device", "passwordHash", "dataStoreIds", "serverUrl"]);
		},

		// ## domain.saveCredentials(username, password)
		//
		// Store the user password for the domain
		//
		saveCredentials: function (username, password) {
			this.user(username);
			this.passwordHash(hashPassword(username, password));
		},

		// ## domain.clearCredentials()
		//
		// Removes user information from the domain
		//
		clearCredentials: function () {
			this.user(null);
			this.passwordHash(null);
		},

		// ## domain.testCredentials(username, password)
		//
		// Returns TRUE if the username/password matches locally stored credentials
		//
		testCredentials: function (username, password) {
			return this.user() === username
				&& this.passwordHash() === hashPassword(username, password);
		},

		// ## domain.remove()
		//
		// Removes the domain singleton
		//
		remove: function () {
			cachedDomain = undefined;

			// Delete data child entries
			_.each(this.dataStoreIds() || [], function (datastoreId) {
				var ds = DatastoreInfo.retrieve(datastoreId);
				if (ds) {
					ds.remove();
				}
			});

			// Remove our storage
			Storage.prototype.remove.call(this);
		},

		// ## domain.addDatastore(datastoreId)
		//
		// Creates a data store with the specified datastoreId and returns it to the caller.
		//
		addDatastore: function (datastoreId) {
			var datastoreIds = (this.dataStoreIds() || []);
			if (_.indexOf(datastoreIds, datastoreId) >= 0) {
				throw new Error("Duplicate datastoreId " + datastoreId);
			}
			var datastore = DatastoreInfo.create(datastoreId);
			datastoreIds.push(datastoreId);
			this.dataStoreIds(datastoreIds);
			return datastore;
		},

		// ## domain.getDatastoreById(datastoreId)
		//
		// Returns a data store based on datastoreId
		//
		getDatastoreById: function (datastoreId) {
			return DatastoreInfo.retrieve(datastoreId);
		},

		// ## domain.removeDatastore(datastoreId)
		//
		// Removes a data store based on datastoreId
		//
		removeDatastore: function (datastoreId) {
			var datastoreIds = (this.dataStoreIds() || []);
			var index = _.indexOf(datastoreIds, datastoreId);
			if (index < 0) {
				throw new Error("Invalid datastoreId " + datastoreId);
			}

			datastoreIds.splice(index, 1);
			this.dataStoreIds(datastoreIds);

			var ds = DatastoreInfo.retrieve(datastoreId);
			if (ds) {
				ds.remove();
			}
		},

		// ## domain.getNumDatastores()
		//
		// Returns number of data stores
		//
		getNumDatastores: function () {
			return (this.dataStoreIds() || []).length;
		},

		// ## domain.getDatastore(index)
		//
		// Returns a data store based on index
		//
		getDatastore: function (index) {
			var datastoreId = this.dataStoreIds()[index];
			return this.getDatastoreById(datastoreId);
		},

		// ## domain.incomingDir()
		//
		// Returns path to domain's **Incoming** directory
		//
		// This diretory contains all MTLs that have been downloaded from the server
		//
		incomingDir: function () {
			return "/Incoming/";
		},

		// ## domain.outgoingDir()
		//
		// Returns path to domain's **Outgoing** directory
		//
		// This diretory contains MTCs that should be uploaded to the server
		//
		outgoingDir: function () {
			return "/Outgoing/";
		},

		// ## domain.dsDeploymentsDir()
		//
		// Returns path to domain's **DataStores/Install** directory
		//
		// This directory contains all the data deployment MTLs that are ready for processing
		//
		dsDeploymentsDir: function () {
			return "/DataStores/Install/";
		},

		// ## domain.getDSDeploymentModelDir(datastoreId, version)
		//
		// Returns the directory of the .mdm file for the (datastoreId, version) deployment
		//
		// This diretory contains all the data deployment MTLs that are ready for processing
		//
		getDSDeploymentModelDir: function (datastoreId, version) {
			return this.dsDeploymentsDir() + datastoreId + "." + version + "/";
		},

		// ## domain.getDSDeploymentModelPath(dsDeploymentSettings)
		//
		// Returns path to the .mdm file that corresponds to the given deployment settings
		//
		// This diretory contains all the data deployment MTLs that are ready for processing
		//
		getDSDeploymentModelPath: function (settings) {
			return this.getDSDeploymentModelDir(settings.dataStoreId, settings.modelVersion) + settings.modelId + ".mdm";
		}
	});

	function hashPassword(username, password) {
		return Encryption.sha1(username + "\0" + password, false);
	}

	// ## Domain.create()
	//
	// Creates a domain settings instance
	//
	Domain.create = function () {
		cachedDomain = new Domain();
		return cachedDomain;
	};

	// ## Domain.retrieve()
	//
	// Retrieves the domain singleton.
	// Returns `undefined` if the domain hasn't been configured
	//
	Domain.retrieve = function () {
		var domain = cachedDomain;

		if (!domain) {
			domain = new Domain();
			if (!domain.name()) {
				return undefined;
			}
			cachedDomain = domain;
		}
		return domain;
	};

	return Domain;

});
define('MDO/AsyncEvents',["AH", "underscore", "backbone"], function(AH, _, Backbone) {

	"use strict";

	function triggerEvents(p, events, args) {
		return _.reduce(events, function(prev, ev) {
			return AH.when(prev, function() {
				return ev.callback.apply(ev.ctx, args);
			});
		}, p);
	}

	/**
	 * @class MDO.AsyncEvents
	 * @private
	 *
	 * Mixin class extending `Backbone.Events`
	 *
	 */

	return _.extend({

		/**
		 * @method asyncTrigger
		 *
		 * Trigger a single event, firing each bound callback after the previous callback's return value resolves.
		 * Callbacks are passed the same arguments as `asyncTrigger` is, apart from the event name
		 * (unless you're listening on `"all"`, which will cause your callback to
		 * receive the true name of the event as the first argument).
		 *
		 * @param name
		 *
		 * Name of the event to trigger
		 *
		 * @returns {Promise} that resolves with the event emitter
		 */
		asyncTrigger: function(name) {
			var p = AH.resolve(self),
				pSelf = p;

			if (this._events) {
				var args = Array.prototype.slice.call(arguments, 1);
				var events = this._events[name];
				if (events) {
					p = triggerEvents(p, events, args);
				}
				var allEvents = this._events.all;
				if (allEvents) {
					p = triggerEvents(p, allEvents, arguments);
				}
				if (p !== pSelf) {
					pSelf = p.then(function() {
						return self;
					});
				}
			}
			return pSelf;
		}
	}, Backbone.Events);

});
define('Files/fs',[
	"AH",
	"Constants",
	"underscore"
], function (
	AH,
	Constants,
	_
	) {

	"use strict";

	// # Files module
	//
	// Represent a file system on top of a websql database
	// Requests 45 MB of storage so that the user is prompted as soon as MDO.js is loaded
	// iOS fails if we try to ask for 50MB for multiple databases, so just use @fsdb because
	// it will be created anytime MDO.js is included as part of an application
	//
	// All operations are asynchronous and return a deferred promise
	//
	return (function () {

		var FSDB_NAME = "@fsdb";

		var fsdb;
		var openPromise;

		function open() {
			// Make sure that calling 'open' more than once returns the same promise,
			// unless the previous call failed
			if (openPromise) {
				return openPromise;
			}

			fsdb = AH.websql(FSDB_NAME, "", "@hand File System");
			var promise = fsdb.promise
				.then(initializeSchema);

			openPromise = promise;

			openPromise
				.then(null, close);

			return promise;
		}

		function close() {
			openPromise = undefined;

			fsdb = undefined;
		}

		// ## format()
		//
		// Wipes away and closes the file system database
		//
		function format() {
			return open()
				.then(function() {
					return fsdb.destroyDatabase();
				})
				.then(close, close);
		}

		// ## readFile(path) or readFile(dir, name)
		//
		// Reads the file at the specified path.
		//
		// Resolves a file object with the following properties:
		//
		//	* path: full path of file
		//	* dir: file directory
		//	* name: file name
		//	* content: file contents
		//	* size: file size (in characters)
		//	* created: timestamp when file was created
		//	* updated: timestamp when file was updated
		//
		function readFile(dir, name) {
			var fd = fileDescriptor(dir, name);
			var sql = "SELECT dir || name as path, * FROM files WHERE dir = ? AND name = ?";
			return open().then(function () {
				return fsdb.readRow(sql, [fd.dir, fd.name])
					.then(function (row) {
						if (!row) {
							return pathNotFoundError("readFile", fd.path);
						}
						return row;
					});
			});
		}

		// ## readJsonFile(path) or readJsonFile(dir, name)
		//
		// Reads the file at the specified path, as a json file.
		//
		// Resolves a file object with the following properties:
		//
		//	* path: full path of file
		//	* dir: file directory
		//	* name: file name
		//	* content: file contents parsed as json
		//	* size: file size (in characters)
		//	* created: timestamp when file was created
		//	* updated: timestamp when file was updated
		//
		function readJsonFile(dir, name) {
			return readFile(dir, name)
				.then(parseJsonContent);

			function parseJsonContent(file) {
				return _.defaults({ content: JSON.parse(file.content) }, file);
			}
		}

		// ## readJsonFileContent(path) or readJsonFileContent(dir, name)
		//
		// Reads the json contents of the file at the specified path.
		//
		// Resolves a javascript object from the json content:
		function readJsonFileContent(dir, name) {
			return readJsonFile(dir, name)
				.then(function (file) {
					return file.content;
				});
		}

		// ## writeFile(path, data, overWrite) or writeFile(dir, name, data, overWrite)
		//
		// Creates a file at the specified `path` containing `data`
		//
		// Fails if a file at that path already exists.
		//
		function writeFile(dir, name, data, overWrite) {
			var fd;
			if (data === undefined
				|| typeof data === "boolean") {
				fd = fileDescriptor(dir);
				overWrite = data;
				data = name;
			} else {
				fd = fileDescriptor(dir, name);
			}

			return fd.validate("writeFile")
				.then(performFileWrite);

			function performFileWrite() {
				var sql = AH.format("{0} INTO files (dir, name, content, size) VALUES (?, ?, ?, ?)",
					overWrite
					? "INSERT OR REPLACE"
					: "INSERT");
				return open().then(function () {
					return fsdb.execute(sql, [fd.dir, fd.name, data, data.length])
						.then(null, createFileWriteErrorHandler("writeFile", fd.path));
				});
			}
		}

		// ## writeJsonFile(path, data, overWrite) or writeJsonFile(dir, name, data, overWrite)
		//
		// Creates a file at the specified `path` containing stringified json `data`
		//
		// Fails if a file at that path already exists.
		//
		function writeJsonFile(dir, name, data, overWrite) {
			// JSON.stringify can throw an Error
			return AH.deferredTryCatch(function() {
				if (data === undefined
					|| typeof data === "boolean") {
					overWrite = data;
					data = name;
					name = "";
				}

				return writeFile(dir, name, JSON.stringify(data), overWrite);
			});
		}

		// ## copyFile(srcPath, dstPath, overwrite?)
		//
		// Copies file from `sourcePath` to `destinationPath`.
		//
		// Fails if overwrite is false and destinationPath already exists.
		//
		function copyFile(srcPath, dstPath, overwrite) {
			var fdSrc = fileDescriptor(srcPath);
			var fdDst = fileDescriptor(dstPath);

			return fdSrc.validate("copyFile - srcPath")
				.then(function () {
					return fdDst.validate("copyFile - fdDst");
				})
				.then(performFileCopy);

			function performFileCopy() {
				var sql = overwrite ? "INSERT OR REPLACE" : "INSERT";
				sql += " INTO files (dir, name, content, size, created, updated) "
					+ "SELECT ?, ?, content, size, created, updated FROM files "
						+ "WHERE dir = ? AND name = ?";
				return open().then(function () {
					return fsdb.execute(sql, [fdDst.dir, fdDst.name, fdSrc.dir, fdSrc.name])
						.then(null, createFileWriteErrorHandler("copyFile", fdDst.path));
				});
			}
		}

		// ## moveFile(srcPath, dstPath)
		//
		// Copies a file from `sourcePath` to `destinationPath`.
		//
		// Fails if destinationPath already exists.
		//
		function moveFile(srcPath, dstPath) {
			var fdSrc = fileDescriptor(srcPath);
			var fdDst = fileDescriptor(dstPath);

			return fdSrc.validate("moveFile - srcPath")
				.then(function () {
					return fdDst.validate("moveFile - fdDst");
				})
				.then(performFileMove);

			function performFileMove() {
				var sql = "UPDATE files SET dir=?, name=? WHERE dir=? AND name=?";
				return open().then(function () {
					return fsdb.execute(sql, [fdDst.dir, fdDst.name, fdSrc.dir, fdSrc.name])
						.then(function (rs) {
							if (rs.rowsAffected !== 1) {
								return pathNotFoundError("moveFile", fdSrc.path);
							}
							return rs;
						}, createFileWriteErrorHandler("moveFile", fdDst.path));
				});
			}
		}

		function createFileWriteErrorHandler(operation, path) {

			return function handleFileWriteError(error) {
				switch (error.sqlError.code) {
					case Constants.sqlError.DATABASE_ERR:
					case Constants.sqlError.CONSTRAINT_ERR:
						// If we have a path, then the constraint is most likely due to the path already existing (duplicate primary keys)
						if (path) {
							error.message = operation + ": duplicate file '" + path + "'";
						} else {
							error.message = operation + " operation failed";
						}
						break;
					case Constants.sqlError.QUOTA_ERR:
						error.message = "Database quota has been exceeded";
						break;
					case Constants.sqlError.UNKNOWN_ERR:
					case Constants.sqlError.VERSION_ERR:
					case Constants.sqlError.TOO_LARGE_ERR:
					case Constants.sqlError.SYNTAX_ERR:
					case Constants.sqlError.TIMEOUT_ERR:
						// Other error codes aren't handled specially at this time.
						break;
					default:
						// New, unknown error code.
						break;
				}
				return AH.reject(error);
			};
		}


		// ## deleteFile(path, failIfMissing) or deleteFile(dir, name, failIfMissing)
		//
		// Deletes the file at the specified `path`
		//
		// Fails if the file does not exists and `failIfMissing` is true.
		//
		function deleteFile(dir, name, failIfMissing) {
			if (failIfMissing === undefined && typeof (name) !== "string") {
				failIfMissing = name;
				name = undefined;
			}
			var fd = fileDescriptor(dir, name);
			var sql = "DELETE FROM files WHERE dir = ? AND name = ?";
			return open().then(function () {
				return fsdb.execute(sql, [fd.dir, fd.name])
					.then(function (rs) {
						if (rs.rowsAffected !== 1 && failIfMissing) {
							return pathNotFoundError("deleteFile", fd.path);
						}
						return rs;
					});
			});
		}

		// ## deleteDirectory(dir, failIfMissing?)
		//
		// Deletes all files inside the specified `dir`
		//
		// Fails if the dir does not exists and `failIfMissing` is true.
		//
		function deleteDirectory(dir, failIfMissing) {
			var sql = "DELETE FROM files WHERE dir LIKE ?";
			return open().then(function () {
				return fsdb.execute(sql, [dir + "%"])
					.then(function (rs) {
						if (rs.rowsAffected < 1 && failIfMissing) {
							return pathNotFoundError("deleteDirectory", dir);
						}
						return rs;
					});
			});
		}

		// ## deleteMatchingFilesFromDirectory(dir, pattern)
		//
		// Deletes the files at the specified `dir` that match, or do NOT match, the given `pattern`
		//
		// `dir` specifies the directory where files should be deleted (subdirectories are not included)
		// `pattern` specifies the pattern to use when matching files
		// `isExclusivePattern` specifies whether the `pattern` is inclusive or exclusive.
		//		When false (default), files matching the pattern are deleted.
		//		When true, files NOT matching the pattern are deleted.
		//
		// Wild cards may only exist at the file name level
		//
		function deleteFiles(dir, pattern, isExclusivePattern) {
			if (!_.isString(dir)) {
				return AH.reject("'dir' is required");
			}

			if (!_.isString(pattern)) {
				return AH.reject("'pattern' is required");
			}

			var args = [], where = [];

			appendDirectoryFilePatternSql(dir, pattern, where, args, isExclusivePattern);

			// Build SQL
			var sql = "DELETE FROM files WHERE " + where.join(" AND ");

			return open()
				.then(function () {
					return fsdb.execute(sql, args);
				});
		}

		// ## listFiles(dir, pattern, comparer) or listFiles(dir, pattern) or listFiles(dir)
		//
		// Returns an array of files whose name match the pattern of the following format:
		//
		//		*.txt
		//
		// When a `comparer` is specified, the returned fileInfo objects are sorted using the comparer
		//
		// Wild cards may only exist at the file name level
		//
		function listFiles(dir, pattern, comparer) {
			var args = [], where = [];

			appendDirectoryFilePatternSql(dir, pattern, where, args);

			// Build SQL
			var sql = "SELECT dir || name as path, dir, name, size, created, updated FROM files";
			if (where.length) {
				sql += " WHERE " + where.join(" AND ");
			}

			return open().then(function () {
				return fsdb.read(sql, args)
					.then(function (rs) {
						var files = [];
						for (var i = 0; i < rs.rows.length; i++) {
							files.push(rs.rows.item(i));
						}

						if (!comparer) {
							return files;
						}

						return files.sort(comparer);
					});
			});
		}

		function appendDirectoryFilePatternSql(dir, pattern, where, args, isExclusivePattern) {
			// Add directory clause, if specified
			if (dir) {
				where.push("dir = ?");
				args.push(dir);
			}

			// Add pattern clause, if specified
			if (pattern) {
				pattern = pattern.replace(/\*/g, "%");
				if (isExclusivePattern) {
					where.push("name NOT LIKE ?");
				} else {
					where.push("name LIKE ?");
				}
				args.push(pattern);
			}
		}

		// ### fileDescriptor(dir, name) or fileDescriptor(path)
		//
		// Returns an object that contains:
		//
		//	* dir (directory)
		//	* name (file name)
		//	* path (full path)
		//
		function fileDescriptor(dir, name) {
			if (!name) {
				var nameOffset = dir.lastIndexOf("/") + 1;
				name = dir.substr(nameOffset);
				dir = dir.substr(0, nameOffset);
			}

			return {
				dir: dir,
				name: name,
				path: dir + name,
				validate: fileDescriptorValidate
			};
		}

		// Validate this.directory/name are valid.
		// Returns promise that resolves when `this` is valid.
		function fileDescriptorValidate(op) {
			op = op || "file operation";
			var name = this.name;
			if (!name || name.indexOf("/") >= 0
				|| name.indexOf(" ") === 0 || name.lastIndexOf(" ") === name.length - 1) {
				return AH.reject(new Error(op + ": invalid file name '" + name + "'"));
			}
			var dir = this.dir;
			if (!dir
				|| dir.indexOf("/") !== 0 || dir.lastIndexOf("/") !== dir.length - 1) {
				return AH.reject(new Error(op + ": invalid directory '" + dir + "'"));
			}
			return AH.resolve(this);
		}

		// ### pathNotFoundError(operation, path)
		//
		// Returns a rejected promise describing the error
		//
		function pathNotFoundError(operation, path) {
			var error = new Error(operation + ": path not found '" + path + "'");
			return AH.reject(error);
		}

		// ### initializeSchema()
		//
		// Initializes the DB schema for the file system
		//
		function initializeSchema() {
			var sql = "CREATE TABLE IF NOT EXISTS files ("
				+ "dir NOT NULL, name NOT NULL, content, size INTEGER, "
				+ "created DEFAULT CURRENT_TIMESTAMP, updated DEFAULT CURRENT_TIMESTAMP, "
				+ "UNIQUE( dir, name)"
				+ "CHECK( dir LIKE '/%' AND dir LIKE '%/' AND length(name) > 0 )"
				+ ")";

			return fsdb.execute(sql);
		}

		// ## pathSeqNumCompare(a, b)
		//
		// Numerically compare the sequence numbers of two file names `a` and `b` that are in the form of "prefix.SeqNum.extension"
		//
		// Returns a negative, 0 or positive number based on the comparison.
		//
		function pathSeqNumCompare(a, b) {
			return getPathSeqNum(a) - getPathSeqNum(b);
		}

		// ## getPathSeqNum(path)
		//
		// Returns the sequence number in the file `path` that is in the form of "prefix.SeqNum.extension"
		//
		// Throws an exception if path is not of the correct format
		//
		function getPathSeqNum(path) {
			if (typeof (path) !== "string") {
				path = (path && (path.name || path.path)) || "";
			}
			var reVersion = /\.(\d+)\.[^\.]+$/;
			var match = path.match(reVersion);
			if (!match || !match.length) {
				throw new Error("Path does not contain a sequence number: '" + path + "'");
			}
			// Return as number
			return Number(match[1]);
		}

		return {
			format: format,

			readFile: readFile,
			writeFile: writeFile,
			copyFile: copyFile,
			moveFile: moveFile,
			deleteFile: deleteFile,
			deleteDirectory: deleteDirectory,
			deleteFiles: deleteFiles,
			listFiles: listFiles,

			readJsonFile: readJsonFile,
			readJsonFileContent: readJsonFileContent,

			writeJsonFile: writeJsonFile,

			getPathSeqNum: getPathSeqNum,
			pathSeqNumCompare: pathSeqNumCompare
		};

	}());

});
// Logging/settings
//
/**
* @class Logging.Settings
* @singleton
* Class contains settings used by {@link Logging.Logger}
*
* If settings are changed, {@link Logging.Logger#initialize Logger.initialize()} needs to be recalled to apply the settings.
*
* ### Usage:

		mdoClient.logger.settings.echoToConsole(true);
		mdoClient.logger.initialize();
*/


define('Logging/settings',[
	"underscore",
	"LocalStorage/Storage"
], function (
	_,
	Storage) {
	"use strict";
	
	
	var defaults = {
		/**
		* @method echoToConsole
		* Getter/Setter for echoToConsole setting
		*
		* If true, the log messages are echoed to the console
		*
		* @param {Boolean} [Boolean=false]
		*/
		echoToConsole: false,

		/**
		* @method daysToKeepLogs
		* Getter/Setter for daysToKeepLogs setting
		*
		* The number of days to keep log messages. Messages older than the specified number of days are deleted.
		*
		* @param {number} [number=7]
		*/
		daysToKeepLogs: 7,

		/** @method hoursBetweenOldLogClears
		* Getter/Setter for hoursBetweenOldLogClears setting
		*
		* The number of hours between checks for old logs.
		*
		* @param {number} [number=24]
		*/
		hoursBetweenOldLogClears: 24
	};

	var Settings = Storage.extend({
		initialize: function () {
			Storage.prototype.initialize.call(this, "@loggerSettings", _.keys(defaults), undefined, defaults);
		}
	});

	return new Settings();
});

// Logging/logger
//
/**
* @class Logging.Logger
* @singleton
* @uses Logging.Settings
*
* Represents a logger on top of a websql database.
*
* Old logs are automatically cleared based on the {@link Logging.Logger#settings} property
*
* Exposed through {@link MDO.Client#logger}
*
* ### Usage:
*
*       mdoClient.logger.log("Log Message");
*/

/**
* @property logsDb
*
* @readonly
*
* @private
*
* webSql object for the logger
*/

/**
* @property _clearLogsInterval
*
* @private
*
*  Millisecond interval for calls to {@link Logging.Logger#clearOldLogs}
*/

define('Logging/logger',[
	"AH",
	"underscore",
	"./settings"
], function (
	AH,
	_,
	settings
	) {

	"use strict";

	function Logger() {
		this._logsDb = AH.websql("@logs", "", "@hand Logs");
		this._clearLogsInterval = null;
		this.initialize.apply(this, arguments);
	}

	_.extend(Logger.prototype, {

		/**
		* @property settings
		* Exposed {@link Logging.Settings} to control the logging settings
		*/
		settings: settings,

		/**
		* @method initialize
		*
		* Opens the logger database, sets the {@link Logging.Settings settings}.
		*
		* *initialize()* is called on creation of the Logger, so it only needs to be called if the {@link Logging.Logger#settings settings} have been changed
		*
		* @returns {Promise}
		*
		* Returns a {@link Promise} that resolves when the operation completes.
		*
		* @async
		*/
		initialize: function() {
			this._initPromise = this._logsDb.promise
				.then(_.bind(this._initializeSchema, this));
			// Inititalize the automatic log clearing
			this.setClearLogsInterval(settings.hoursBetweenOldLogClears() * 3600000); // 3600000 ms = 1 hour
			this.clearOldLogs();

			return this._initPromise;
		},


		/**
		* @method initializeSchema
		*
		* @private
		*
		* Initializes the DB schema for the logger
		*/
		_initializeSchema: function() {
			var sql = "CREATE TABLE IF NOT EXISTS logs ("
				+ "domainId, "
				+ "appId, "
				+ "category COLLATE NOCASE, "
				+ "message TEXT NOT NULL, "
				+ "timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP"
				+ ")";

			return this._logsDb.execute(sql);
		},

		/**
		* @method log
		*
		* Logs a message with optional options
		*
		* ## Usage
		*
		*       var options = {
		*           domainId: "{ec09b270-7438-465a-98fd-6344b035cb80}",
		*           appId: "{d2319398-0d3c-4048-b957-576e010c2e17}",
		*           category: "Warning"
		*       };
		*
		*       mdoClient.logger.log("Message", options);
		*
		* @param {string} message
		* The message to be logged
		*
		* @param [options]
		* Object for specifying characteristics of a log
		*
		* @param {string} [options.domainId]
		* The domain ID for thelog
		*
		* @param {string} [options.appId]
		* The application ID for the log
		*
		* @param {string} [options.category]
		* The category for the log
		*
		* @returns {Promise}
		* Returns a {@link Promise} that resolves when the operation completes.
		*
		* @async
		*/
		log: function(message, options) {
			var self = this;
			options = options || {};

			if (!message) {
				return AH.reject("'message' is required");
			}

			return this._initPromise
				.then(logToConsole)
				.then(logToDatabase);

			function logToConsole() {
				if (settings.echoToConsole()) {
					console.log(self._formatMessage(message, options));
				}
			}

			function logToDatabase() {
				options = _.pick(options, "domainId", "appId", "category");
				var keys = [];
				var values = [];
				var valuePlaceholders = [];

				_.each(_.keys(options), function(key) {
					var value = options[key];
					if (value === undefined || value === null) {
						return;
					}

					addKeyValuePair(key, value);
				});

				addKeyValuePair("message", message);

				var sql = "INSERT INTO logs (" + keys.join(", ") + ") VALUES (" + valuePlaceholders.join(", ") + ")";

				return self._logsDb.execute(sql, values);

				function addKeyValuePair(key, value) {
					keys.push(key);
					values.push(value);
					valuePlaceholders.push("?");
				}
			}
		},

		/**
		* @method _formatMessage
		*
		* @private
		*
		* Formats a log message according to the passed in options
		*
		* @param {string} message
		* The log message to be formatted
		*
		* @param {Object} [options]
		* Object containing the formatting options
		*
		* @param {string} [options.domainId]
		* The domain ID for thelog
		*
		* @param {string} [options.appId]
		* The application ID for the log
		*
		* @param {string} [options.category]
		* The category for the log
		*
		* @return {string}
		* The formatted log message
		*/
		_formatMessage: function(message, options) {
			options = options || {};
			var formattedMessage;

			if (options.domainId && options.appId) {
				formattedMessage = "(domain:" + options.domainId + " app:" + options.appId + ")";
			} else if (options.domainId) {
				formattedMessage = "(domain:" + options.domainId + ")";
			} else if (options.appId) {
				formattedMessage = "(app:" + options.appId + ")";
			}

			if (options.category) {
				if (formattedMessage) {
					formattedMessage += " " + options.category;
				} else {
					formattedMessage = options.category;
				}
			}

			if (formattedMessage) {
				formattedMessage += ": " + message;
			} else {
				formattedMessage = message;
			}

			return formattedMessage;
		},

		/**
		* @method logError
		* Logs an error, expanding properties and adding them onto the message automatically
		* to create a more descriptive error.
		*
		* ## Handled Error Properties
		*  * sqlError
		*  * sqlError.sql
		*  * sqlError.code
		*  * code
		*  * mdoCode
		*  * exception
		*
		* @param error
		* Error to be logged
		*
		* @param [options]
		*
		* @param {string} [options.code]
		* The error code
		*
		* @param {string} [options.mdoCode]
		* The MDO error code
		*
		* @param [options.sqlError]
		* The SQL error object
		*
		* @param [options.exception]
		* Nested exception object
		*
		* @returns {Promise}
		* Returns a {@link Promise} that resolves when the operation completes.
		*
		* @async
		*/
		logError: function(error, options) {
			if (!error) {
				return AH.reject("'error' parameter is required");
			}
			return this.log(this._formatError(error), _.extend({ category: "ERROR" }, options));
		},

		/**
		* @method formatError(error)
		*
		* @private
		*
		* Formats an error into its expanded, more descriptive format
		*
		* @param error
		* The error to be logged
		*/
		_formatError: function(error) {
			var message = String(error.message || error);
			if (error.code) {
				message += " (Code: " + error.code + ")";
			}
			if (error.mdoCode) {
				message += " (MDOCode: " + error.mdoCode + ")";
			}
			if (error.sqlError) {
				message += " [WebSQL: " + (error.sqlError.message || error.sqlError) + " (SQLError: " + (error.sqlError.code || "??");
				var sql = error.sql || error.sqlError.sql;
				if (sql) {
					message += ", SQL: \"" + sql + "\"";
				}
				message += ")]";
			}
			// If we have a nested exception, add its message to the error;
			//
			// NOTE: If it's necessary to have the full information, refactor
			// to use _formatError recursively and keep track of which
			// errors have been formatted to prevent infinite recursion
			if (error.exception) {
				message += " [Cause: " + (error.exception.message || error.exception) + "]";
			}
			return message;
		},

		/**
		* @method readLogs
		*
		* Reads the set of logs specified by options
		*
		* ## Usage
		*
		*       // Set start to 12 hours ago
		*       var last12hrs = new Date();
		*       last12hrs.setHours(last12hrs.getHours() - 12);
		*
		*       var options = {
		*           domainId: "{ec09b270-7438-465a-98fd-6344b035cb80}",
		*           appId: "{d2319398-0d3c-4048-b957-576e010c2e17}",
		*           start: last12hrs
		*       };
		*
		*       mdoClient.logger.readLogs(options).then(function(logs){
		*           // Operate on array of logs
		*       });
		*
		* @param [options]
		*
		* @param {string} [options.domainId]
		* The domain ID of a given log
		*
		* @param {string} [options.appId]
		* The application ID of a given log
		*
		* @param {string} [options.category]
		* The category of a given log
		*
		* @param {Date} [options.start]
		* The date of the earliest log entry
		*
		* @param {Date} [options.end]
		* The date of the most recent log entry
		*
		* @return {Promise.<Object[]>}
		* Resolves with an array containing objects with the following properties:
		*
		* @return return.domainId The domain Id of the log
		*
		* @return return.appId The application Id of the log
		*
		* @return return.message The log message
		*
		* @return return.timestamp The log's timestamp (in local time)
		*
		* @async
		*/
		readLogs: function(options) {
			// should return insertion order
			var self = this;
			var sql = "SELECT * FROM logs";
			var filter = this._buildSqlFilter(options);

			if (filter.conditions.length) {
				sql += " WHERE " + filter.conditions.join(" AND ");
			}

			return this._initPromise
				.then(readRows)
				.then(mapRows);

			function readRows() {
				return self._logsDb.read(sql, filter.args);
			}

			function mapRows(rs) {
				var logs = [];
				for (var i = 0; i < rs.rows.length; i++) {
					// Parse a Date object from the timestamp property (assuming correct format).
					var dateTime = AH.dateFromDb(rs.rows.item(i).timestamp);

					var rowi = _.defaults({ timestamp: AH.getUtcAsLocalTime(dateTime) }, rs.rows.item(i));
					logs.push(rowi);
				}

				return logs;
			}
		},

		/**
		* @method setClearLogsInterval
		*
		* @private
		*
		* Sets the interval in milliseconds between automatic calls to {@link Logging.Logger#clearOldLogs}
		* If interval is 0 or less than 0, the current callback is cleared and will not
		* be called automatically.
		*
		* @param {number} interval
		* Time period in milliseconds between automatic calls to {@link Logging.Logger#clearOldLogs}
		*
		* @return {number} the interval ID used to register the callback with the browser, or null
		* if there is no callback currently scheduled.
		*/
		setClearLogsInterval: function(interval) {
			// cancel an pre-existing timer, if it is running
			if (this._clearLogsInterval) {
				clearInterval(this._clearLogsInterval);
				this._clearLogsInterval = null;
			}
			// register the new timer, if given a valid interval
			if (interval > 0) {
				this._clearLogsInterval = setInterval(_.bind(this.clearOldLogs, this), interval);
			}
			return this._clearLogsInterval;
		},

		/**
		* @method clearLogs
		*
		* Clears logs from the database that match the specified options
		*
		* @param  [options]
		*
		* @param {string} [options.domainId]
		* The domain ID of a given log
		*
		* @param {string} [options.appId]
		* The application ID of a given log
		*
		* @param {string} [options.category]
		* The category of a given log
		*
		* @param {Date} [options.start]
		* The date of the earliest log entry
		*
		* @param {Date} [options.end]
		* The date of the most recent log entry
		*
		* @returns {Promise}
		* Returns a {@link Promise} that resolves when the operation completes.
		*
		* @async
		*/
		clearLogs: function(options) {
			var self = this;
			var sql = "DELETE FROM logs";
			var filter = this._buildSqlFilter(options);

			if (filter.conditions.length) {
				sql += " WHERE " + filter.conditions.join(" AND ");
			}

			return this._initPromise
				.then(function() {
					return self._logsDb.execute(sql, filter.args);
				});
		},

		/**
		* @method clearOldLogs
		*
		* @private
		*
		* Clears the old logs from the database. The logger uses the daysToKeepLogs property from {@link Logging.Settings#daysToKeepLogs} to determine which logs should be cleared.
		*
		* @returns {Promise}
		* Returns a {@link Promise} that resolves when the operation completes.
		*
		* @async
		*/
		clearOldLogs: function() {
			var currentTs = new Date();
			currentTs.setDate(currentTs.getDate() - settings.daysToKeepLogs());

			return this.clearLogs({ end: currentTs });
		},

		/**
		* @method _buildSqlFilter
		*
		* @private
		*
		* Builds a WHERE statement based on the options passed in
		*
		* @param [options]
		*
		* @param {string} [options.domainId]
		*
		* @param {string} [options.appId]
		*
		* @param {string} [options.category]
		*
		* @param {Date} [options.start]
		*
		* @param {Date} [options.end]
		*
		* @return {Object} The conditions and arguments built from the options passed in
		*/
		_buildSqlFilter: function(options) {
			var conditions = [];
			var args = [];

			if (options) {
				if (options.domainId) {
					conditions.push("domainId = ?");
					args.push(options.domainId);
				}

				if (options.appId) {
					conditions.push("appId = ?");
					args.push(options.appId);
				}

				if (options.category) {
					conditions.push("category = ?");
					args.push(options.category);
				}

				if (options.start) {
					conditions.push("timestamp >= datetime(?, 'unixepoch')");

					// sqlite uses seconds since epoch, but javascript uses milliseconds since epoch
					args.push(Math.floor(options.start.getTime() / 1000));
				}

				if (options.end) {
					conditions.push("timestamp <= datetime(?, 'unixepoch')");

					// sqlite uses seconds since epoch, but javascript uses milliseconds since epoch
					args.push(Math.floor(options.end.getTime() / 1000));
				}
			}

			return {
				conditions: conditions,
				args: args
			};
		}
	});
	

	Object.defineProperties(Logger.prototype, {
		database: {
			get: function () { return this._logsDb; }
		}
	});


	return new Logger();
});

/* eslint id-length: [2, { exceptions: ["_", "i", "v", "c"] }] */
define('Files/Mtl',["underscore"], function (_) {
	"use strict";
	/**
	 * @class Files.Mtl
	 * @private
	 * Mobile Transaction Log
	 */
	function Mtl() {
		// MTL properties
		var mid;
		var v;
		var sid;
		var seqNum;
		var segmentIndex;
		var xacts = [];
		var cids = [];

		// ClassId Cache
		var cId2Index = {};

		// ## addXact(xact)
		//
		// Add the specified `xact` to the `xacts` array.
		//
		function addXact(xact) {
			if (xact.classId) {
				xact = _.extend({}, xact);
				xact.c = getCid(xact.classId);
				delete xact.classId;
			}
			xacts.push(xact);
		}

		// ## insertXacts(newXacts, index)
		//
		// Add the specified `newXacts` array to `xacts` at `index`
		//
		// Modifies `newXacts` in place!
		//
		function insertXacts(newXacts, index) {
			if (newXacts.length === 0) {
				return;
			}

			for (var i = 0; i < newXacts.length; i++) {
				var xact = newXacts[i];
				if (xact.classId) {
					newXacts[i] = xact = _.extend({}, xact);
					xact.c = getCid(xact.classId);
					delete xact.classId;
				}
			}

			xacts = xacts.slice(0, index)
				.concat(newXacts)
				.concat(xacts.slice(index));
		}

		// ## deleteXact(index)
		//
		// Delete a transaction at the specified index
		//
		function deleteXact(index) {
			xacts.splice(index, 1);
		}

		// ## getXact(index)
		//
		// Returns the `index` transaction.  Transaction will have the `classId` property set.
		//
		function getXact(index) {
			var xact = xacts[index];
			if (xact && !_.isUndefined(xact.c)) {
				// Replace `c` with actual `classId`
				xact = _.extend({ classId: cids[xact.c] }, xact);
				delete xact.c;
			}
			return xact;
		}

		// getCid(classId)
		//
		// Returns the numeric id for the specified `classId`
		// adding it to the `cId2Index` and `cids` caches, if necessary.
		//
		function getCid(classId) {
			var cid = cId2Index[classId];

			// 0 is a valid value for cid, so check for undefined instead of !cid
			if (_.isUndefined(cid)) {
				cid = cId2Index[classId] = cids.length;
				cids.push(classId);
			}
			return cid;
		}

		// ## parse(text)
		//
		// Populate Mtl instance from string containing JSON representation
		//
		function parse(text) {
			fromJSON(JSON.parse(text));
		}

		// ## fromJSON(obj)
		//
		// Populate Mtl instance from JSON representation
		//
		function fromJSON(obj) {
			mid = obj.mid;
			v = obj.v;
			sid = obj.sid;
			seqNum = obj["#"];
			xacts = obj.xacts || [];
			cids = obj.cids || [];
			segmentIndex = obj.segmentIndex;

			// Build ClassId cache
			cId2Index = {};
			cids.forEach(function (cid, index) {
				cId2Index[cid] = index;
			});
		}

		// toJSON()
		//
		// Return JSON representation of MTL
		//
		function toJSON() {
			var json = {
				mid: mid,
				v: v,
				sid: sid,
				cids: cids,
				xacts: xacts
			};
			json["#"] = seqNum;
			if (segmentIndex) {
				json.segmentIndex = segmentIndex;
			}
			return json;
		}

		_.extend(this, {
			addXact: addXact,
			insertXacts: insertXacts,
			deleteXact: deleteXact,
			getXact: getXact,
			toJSON: toJSON,
			fromJSON: fromJSON,
			parse: parse
		});

		Object.defineProperties(this, {
			modelId: {
				get: function () { return mid; },
				set: function (modelId) { mid = modelId; }
			},
			modelVersion: {
				get: function () { return v; },
				set: function (modelVersion) { v = modelVersion; }
			},
			seriesId: {
				get: function () { return sid; },
				set: function (seriesId) { sid = seriesId; }
			},
			seqNum: {
				get: function () { return seqNum; },
				set: function (val) { seqNum = val; }
			},
			segmentIndex: {
				get: function () { return segmentIndex; },
				set: function (val) { segmentIndex = val; }
			}
		});

		return this;

	}

	// ## fromJSON(obj)
	//
	// Creates and populates a new Mtl instance from JSON representation
	//
	// Returns a new Mtl instance
	//
	Mtl.fromJSON = function (json) {
		var mtl = new Mtl();
		mtl.fromJSON(json);

		return mtl;
	};

	// Values for the Mtl.t property
	// Keep in sync with in "src\server\dotNET\AtHand.DataSyncInterfaces\Json\Converters\TransactionTypeConverter.cs"
	Mtl.xactType = {
		Begin: "B",
		Create: "C",
		Update: "U",
		Delete: "D",
		End: "E",
		SharedDataVersion: "SDV",
		Sync: "SYNC",
		Identity: "I",
		LoginUser: "LOGUSR",
		CreateValidate: "CV",
		Setting: "DS",
		// The following is only used on the client:
		LocalCreate: "LC"
	};

	return Mtl;
});

define('Files/Mtc',["underscore"], function (_) {
	"use strict";

	var descriptorProperties = "type, version, fileName, contentId, destinationId, domainId, targetId".split(", ");
	/**
	 * @class Files.Mtc
	 * @private
	 * Mobile Transport Container
	 */
	return function () {
		// MTL properties
		var descriptor = {};
		var files = [];

		// ## addFile(name, type, content)
		//
		// Add a file with the specified `name`, `type` and `content` to the `files` array
		//
		function addFile(name, type, content) {
			files.push(_.extend({}, content, {
				fileName: name,
				type: type
			}));
		}

		// toJSON()
		//
		// Return JSON representation of MTL
		function toJSON() {
			return {
				descriptor: descriptor,
				files: files
			};
		}

		return Object.defineProperties({
			addFile: addFile,
			toJSON: toJSON
		}, descriptorProperties.reduce(function (props, name) {
			props[name] = {
				get: function () { return descriptor[name]; },
				set: function (value) { descriptor[name] = value; }
			};
			return props;
		}, {}));

	};
});

define('MDO/Error',[], function () {
	"use strict";

	/**
	 * @class MDO.Error
	 * An Error with an associated Constants.ErrorCode that indicates the type of error the MDO encountered when performing an
	 * operation.
	 *
	 * @param {string} message
	 * The error message describing this exception
	 *
	 * @param {Constants.ErrorCode} code
	 * The numerical error code associated with the condition that caused this exception
	 *
	 * @alternateClassName MdoError
	 */
	function MdoError(message, code) {
		var err = new Error(message);
		this.message = message;
		this.stack = err.stack;
		this.mdoCode = code;
	}
	MdoError.prototype = new Error();

	/**
	 * @property {Constants.ErrorCode} mdoCode
	 * The error code indicating the type of error that occurred.
	 */

	/**
	 * @property {string} stack
	 * The stacktrace showing where the error occurred.
	 */

	/**
	 * @property {string} message
	 * A message which contains a description of the error and other helpful details.
	 */

	return MdoError;
});
/**
@class DataModel.Field

A field in an DataModel.Class.  The field describes the attributes of the underlying database column.

*/
define('DataModel/ModelField',[
	"AH",
	"underscore",
	"Constants",
	"../MDO/Error"
], function (
	AH,
	_,
	Constants,
	MdoError
	) {

	"use strict";

	// ### ModelField ##
	//
	// Class representing an MDM ModelField
	//
	function ModelField(modelClass, jsonField) {
		// Copy field properties
		_.extend(this, jsonField);

		// Normalize Memo fields (textSize=10000)
		if (this.textSize > 4000) {
			this.textSize = undefined;
		}

		this.modelClass = modelClass;
	}

	// #### IndexType enumeration ###
	//
	// Stored in the `index` property
	//
	var IndexType = {
		Index: "Index",
		Unique: "Unique"
	};


	/**
	 * @enum DataModel.Field.FieldType
	 *
	 * Value stored in the {@link DataModel.Field#fieldType fieldType}
	 */
	var FieldType = {
		/** Numeric value */
		Number: "Number",
		/** String value */
		Text: "Text",
		/** Boolean value */
		Bool: "Bool",
		/** Binary value */
		Blob: "Blob",
		/** Date value */
		Date: "Date",
		/** Time value */
		Time: "Time",
		/** TimeStamp value */
		Timestamp: "Timestamp"
	};


	/**
	 * @enum DataModel.Field.NumberType
	 *
	 * Numerical representation of a {@link DataModel.Field.FieldType#Number Number} field stored in the
	 * {@link DataModel.Field#numberType numberType} property.
	 */
	var NumberType = {
		/** 1-byte integer */
		Int8: "Int8",
		/** 2-byte integer */
		Int16: "Int16",
		/** 4-byte integer */
		Int32: "Int32",
		/** 8-byte floating point */
		Float64: "Float64",
		/** Decimal */
		Decimal: "Decimal"
	};

	var NumberLimits = {
		Int8: { min: -127, max: 128 },
		Int16: { min: -32768, max: 32767 },
		Int32: { min: -2147483648, max: 2147483647 },
		Float64: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE }
	};

	// #### TimestampType enumeration ###
	//
	// Stored in the `timestampType` property
	//

	/**
	 * @enum DataModel.Field.TimestampType
	 *
	 * Numerical representation of a {@link DataModel.Field.FieldType#Timestamp Timestamp} field stored in the
	 * {@link DataModel.Field#timestampType timestampType} property.
	 */
	var TimestampType = {
		/** Data value */
		Date: "Date",
		/** Time value */
		Time: "Time",
		/** Timezone-less date and time value */
		DateTime: "DateTime",
		/** UTC-based date and time value */
		Timestamp: "Timestamp"
	};

	/**
	 * @class DataModel.Field
	 */

	/**
	 * @property {String} name
	 *
	 * Table column name for this field.
	 *
	 */

	/**
	 * @property {DataModel.Class} modelClass
	 *
	 * {@link DataModel.Class} this field belongs to.
	 */

	/**
	 * @property {Number} fieldId
	 *
	 * Field identifier.
	 */

	/**
	 * @property {Boolean} allowNull
	 *
	 * True if field is not required
	 */

	/**
	 * @property {Boolean} isTuid
	 *
	 * True if field is part of TUID index
	 */

	/**
	 * @property {DataModel.Field.FieldType} fieldType
	 *
	 * Column type of this field.
	 */

	/**
	 * @property {Number | undefined} textSize
	 *
	 * When defined, indicates the maximum size of a {@link DataModel.Field.FieldType#Text Text} field.
	 *
	 * Memo fields do not have a text size limit.
	 */

	/**
	 * @property {DataModel.Field.NumberType} numberType
	 *
	 * Representation of a {@link DataModel.Field.FieldType#Number Number} field.
	 */

	/**
	 * @property {Number | undefined} numberLength
	 *
	 * Indicates maximum number of digits in a {@link DataModel.Field.NumberType#Decimal Decimal} field.
	 */

	/**
	 * @property {Number | undefined} numberPrecision
	 *
	 * Indicates maximum number of decimal digits in a {@link DataModel.Field.NumberType#Decimal Decimal} field.
	 */

	/**
	 * @property {DataModel.Field.TimestampType} timestampType
	 *
	 * Representation of a {@link DataModel.Field.FieldType#Timestamp Timestamp} field.
	 */

	/**
	 * @method getSchema
	 * @private
	 *
	 * Returns the column descriptor SQL for field
	 *
	 * @returns {String} SQL representing the column schema for this field
	 */
	ModelField.prototype.getSchema = function () {

		var sql = this.name;

		// SQLite doesn't enforce column types but allows you to specify a column *affinity*
		// http://sqlite.org/datatype3.html

		switch (this.fieldType) {
			case FieldType.Number:
				switch (this.numberType) {
					case NumberType.Float64:
					case NumberType.Decimal:
						sql += " REAL";
						break;
					default:
						sql += " INTEGER";
						break;
				}
				// NOTE: We could add a CHECK constraint for min/max values - currently enforced in code
				break;

			case FieldType.Text:
				sql += " TEXT COLLATE NOCASE";
				// NOTE: We could add a CHECK constraint for max length - currently enforced in code
				break;

			default:
				// Timestamp, etc.
				break;
		}

		// Mark PKey as PRIMARY KEY
		switch (this.index) {
			case IndexType.Unique:
				sql += " PRIMARY KEY";
				break;

			default:
				// any other field that's indexed
				break;
		}

		// Add NULL constraint
		if (!this.allowNull) {
			sql += " NOT NULL";
		}

		return sql;
	};


	/**
	 * @method isIdField
	 *
	 * Indicates whether the field is the class's {@link DataModel.Class#idField idField}
	 *
	 * @returns {boolean}
	 */
	ModelField.prototype.isIdField = function () {
		return this.index === IndexType.Unique;
	};


	/* eslint-disable complexity */
	/**
	 * @method validateValue
	 * @private
	 *
	 * Returns a string describing validation problem or `undefined` if `value` is valid.
	 *
	 * @param {*} value
	 *
	 * Value to be validated against field definition.
	 *
	 * @returns {String}
	 *
	 * Description of validation problem or `undefined` if `value` is valid.
	 */
	ModelField.prototype.validateValue = function (value) {
		// Ensure required filed is not null
		if (_.isUndefined(value) || _.isNull(value)) {
			if (!this.allowNull) {
				return "Required field is null";
			}

			return undefined;
		}

		switch (this.fieldType) {
			case FieldType.Number:
				// Ensure it's numeric
				value = Number(value);
				if (!AH.isNumber(value)) {
					return "Not a number";
				}

				// Ensure it's in range
				var numberType = this.numberType;
				if (numberType === NumberType.Decimal) {
					if (this.numberLength) {
						var max = Math.pow(10, this.numberLength - this.numberPrecision);
						if (Math.abs(value) >= max) {
							return "Number value out of range";
						}
					} else {
						// Note: Old model did not serialize length/precision
					}
					return undefined;
				} else if (numberType !== NumberType.Float64) {
					value = Math.round(value);
				}

				var limits = NumberLimits[numberType];
				if (value < limits.min || value > limits.max) {
					return "Number value out of range";
				}
				break;

			case FieldType.Text:
				value = String(value);
				if (this.textSize && value.length > this.textSize) {
					return "String value too long";
				}
				break;

			case FieldType.Timestamp:
				if (!Date.parse(value)) {
					return "Not a " + this.timestampType;
				}
				break;

			case FieldType.Bool:
				if (!_.isBoolean(value)) {
					return "Not a Boolean";
				}
				break;

			case FieldType.Blob:
				if (!_.isArray(value)
					|| !_.every(value, isValidByte)) {
					return "Not a Blob";
				}
				break;

			default:
				throw new Error("Unknown field type: " + this.fieldType);
		}

		function isValidByte(num) {
			num = Number(num);
			return AH.isNumber(num) && num >= 0x00 && num <= 0xff;
		}

		return undefined;
	};
	/* eslint-enable complexity */

	/**
	 * @method normalizeValue
	 * @private
	 *
	 * Converts `value` to match the model field definition in type and resolution.
	 *
	 * Throws a validation error the value cannot be converted.
	 *
	 * @param value
	 *
	 * Value to be normalized
	 *
	 * @returns {*}
	 *
	 * Normalized value
	 */
	ModelField.prototype.normalizeValue = function (value) {
		// Convert null/undefined to null
		if (!AH.isDefined(value)) {
			return null;
		}

		// Make sure value is valid
		var error = this.validateValue(value);
		if (error) {
			throw new Error("Invalid field value - " + error + " (" + this.modelClass.name + "." + this.name + ")");
		}

		// Convert to strict type
		switch (this.fieldType) {
			case FieldType.Timestamp:
				value = new Date(value);
				break;
			case FieldType.Number:
				// Ensure it's numeric
				value = Number(value);
				switch (this.numberType) {
					case NumberType.Decimal:
						if (_.isNumber(this.numberPrecision)) {
							value = Number(value.toFixed(this.numberPrecision));
						}
						break;
					case NumberType.Float64:
						break;
					default: // Integer type
						value = Math.round(value);
						break;
				}
				break;
			case FieldType.Text:
				value = String(value);
				break;
			default:
				// other field types
				break;
		}

		return value;
	};

	/**
	 * @method valueToDb
	 * @private
	 *
	 * Converts JavaScript value used by MDO.js into representation that can be written to the WebSQL database.
	 *
	 * @param {*} value
	 *
	 * Value to be converted.
	 *
	 * @returns {*}
	 *
	 * Value representation that can be written to the WebSQL database.
	 */
	ModelField.prototype.valueToDb = function (value) {
		if (!AH.isDefined(value)) {
			return value;
		}
		try {
			switch (this.fieldType) {
				case FieldType.Bool:
					return AH.boolToDb(value);
				case FieldType.Blob:
					return AH.blobToDb(value);
				case FieldType.Timestamp:
					if (this.timestampType === TimestampType.Timestamp) {
						value = AH.getLocalTimeAsUtc(value);
					}
					return AH.dateToDb(value);
				case FieldType.Number:
					if (this.numberType === NumberType.Decimal
						&& _.isNumber(this.numberPrecision)) {
						value = AH.toFixedNumber(value, this.numberPrecision);
					}
					return value;
				default:
					return value;
			}
		} catch (err) {
			throw new MdoError("Unable to convert " + this.modelClass.name + "." + this.name + " value (" + value + ") to DB.", Constants.errorCodes.notSupported);
		}
	};


	/**
	 * @method valueFromDb
	 * @private
	 *
	 * Converts WebSQL value into JavaScript representation to be used by MDO clients.
	 *
	 * @param {*} value
	 *
	 * Value from database.
	 *
	 * @returns {*}
	 *
	 * Value in representation to be used by MDO clients.
	 */
	ModelField.prototype.valueFromDb = function (value) {
		if (!AH.isDefined(value)) {
			return value;
		}
		try {
			switch (this.fieldType) {
				case FieldType.Bool:
					return AH.boolFromDb(value);
				case FieldType.Blob:
					return AH.blobFromDb(value);
				case FieldType.Timestamp:
					value = AH.dateFromDb(value);
					if (this.timestampType === TimestampType.Timestamp) {
						value = AH.getUtcAsLocalTime(value);
					}
					return value;
				default:
					return value;
			}
		} catch (err) {
			throw new MdoError("Unable to convert " + this.modelClass.name + "." + this.name + " value (" + value + ") from DB.", Constants.errorCodes.notSupported);
		}
	};


	/**
	 * @class DataModel.FieldArray
	 *
	 * Array of {@link DataModel.Field} items.
	 */
	function ModelFieldArray(modelClass, fields) {
		this.modelClass = modelClass;
		AH.appendArray(this, fields);
	}

	ModelFieldArray.prototype = [];


	/**
	 * @method getByName
	 *
	 * Returns a {@link DataModel.Field} based on its {@link DataModel.Field#name name} property
	 *
	 * @param {String} name
	 *
	 * Identifies the field
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the field cannot be found.
	 *
	 * @returns {DataModel.Field}
	 *
	 * Field matching the specified `name`.
	 */
	ModelFieldArray.prototype.getByName = function (name, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "name", name, throwErrorIfNotFound ? _.bind(throwError, this) : undefined);

		function throwError() {
			throw new MdoError("'" + this.modelClass.name + "." + name + "' model field does not exist.", Constants.errorCodes.unknownModelField);
		}
	};


	/**
	 * @method getByFieldId
	 *
	 * Returns a {@link DataModel.Field} based on its {@link DataModel.Field#fieldId fieldId} property
	 *
	 * @param {Number} id
	 *
	 * Identifies the field
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the field cannot be found.
	 *
	 * @returns {DataModel.Field}
	 *
	 * Field matching the specified `fieldId`.
	 */
	ModelFieldArray.prototype.getByFieldId = function (id, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "fieldId", id, throwErrorIfNotFound ? _.bind(throwError, this) : undefined);

		function throwError() {
			throw new MdoError("'" + this.modelClass.name + "' model field with id '" + id + "' does not exist.", Constants.errorCodes.unknownModelField);
		}
	};

	// #### ModelField.makeArray(modelClass, arr, makeFields) ####
	//
	// Converts a regular array `arr` into a ModelFieldArray
	// and converts the elements into instances of
	// `ModelField`.
	//
	// modelClass: The model class of the fields in 'arr'
	// arr: The array of fields to be converted into a ModelFieldArray
	// makeFields: Indicates whether the fields in 'arr' should be converted to ModelField instances
	//
	function makeFieldArray(modelClass, arr, makeFields) {
		var fields = makeFields ? _.map(arr, function(field) {
			return new ModelField(modelClass, field);
		}) : arr;

		return new ModelFieldArray(modelClass, fields);
	}

	// #### ModelField.isIdField(field) ####
	//
	// Returns true if field is an ID field
	//
	function isIdField(field) {
		return field && field.isIdField();
	}

	return {
		makeArray: makeFieldArray,
		isIdField: isIdField
	};

});
/**
@class DataModel.Element

An element in a {@link DataModel.Class}. The element describes which releated {@link DataModel.Class Class} is referenced by it.

*/
define('DataModel/ModelElement',[
	"AH",
	"underscore",
	"Constants",
	"../MDO/Error"
], function (
	AH,
	_,
	Constants,
	MdoError
	) {

	"use strict";

	// ### ModelElement ##
	//
	// Class representing an MDM ModelElement
	//
	function ModelElement(modelClass, jsonElement) {

		// Copy element properties
		_.extend(this, jsonElement);
		this.modelClass = modelClass;
		
		// Add link from field
		this.referenceField.element = this;

		// Add it to referencingElements on refClass
		// Get (create, if necessary) referencingElements from other class
		var refElts = (this.refClass.referencingElements || (this.refClass.referencingElements = []));
		refElts.push(this);
	}

	/**
	 * @property {String} name
	 *
	 * Name of this field.
	 */

	/**
	 * @property {DataModel.Class} modelClass
	 *
	 * {@link DataModel.Class} this element belongs to.
	 */

	/**
	 * @property {String} refClassId
	 * @private
	 *
	 * The {@link DataModel.Class#classId classId} of this element's {@link DataModel.Element#refClass refClass}.
	 */

	/**
	 * @property {Number} fieldId
	 * @private
	 *
	 * The {@link DataModel.Field#fieldId fieldId} of this element's {@link DataModel.Element#referenceField referenceField}.
	 */

	/**
	 * @property {DataModel.Class} refClass
	 *
	 * Class referenced by this element.
	 */
	Object.defineProperty(ModelElement.prototype, "refClass", {
		get: function () {
			if (!this._refClass) {
				this._refClass = this.modelClass.model.classes.getByClassId(this.refClassId);
			}

			return this._refClass;
		}
	});


	/**
	 * @property {DataModel.Field} referenceField.
	 *
	 * Field in this class that corresponds to this element.
	 */
	Object.defineProperty(ModelElement.prototype, "referenceField", {
		get: function () {
			return this.modelClass.fields.getByFieldId(this.fieldId);
		}
	});


	/**
	 * @class DataModel.ElementArray
	 *
	 * Array of {DataModel.Element} items.
	 */
	function ModelElementArray(modelClass, elements) {
		this.modelClass = modelClass;
		AH.appendArray(this, elements);
	}

	ModelElementArray.prototype = [];

	/**
	 * @method getByName
	 *
	 * Returns a {@link DataModel.Element} based on its {@link DataModel.Element#name name} property
	 *
	 * @param {String} name
	 *
	 * Identifies the element
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the element cannot be found.
	 *
	 * @returns {DataModel.Element}
	 *
	 * Element matching the specified `name`.
	 */
	ModelElementArray.prototype.getByName = function (name, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "name", name, throwErrorIfNotFound ? _.bind(throwError, this) : undefined);

		function throwError() {
			throw new MdoError("'" + this.modelClass.name + "." + name + "' model element does not exist.", Constants.errorCodes.unknownModelElement);
		}
	};

	// #### makeArray(modelClass, arr, makeElements) ####
	//
	// Converts a regular array `arr` into a ModelElementArray
	// and converts the elements into instances of
	// `ModelElement`.
	//
	// modelClass: The model class of the elements in 'arr'
	// arr: The array of elements to be converted into a ModelElementArray
	// makeElements: Indicates whether the elements in 'arr' should be converted to ModelElement instances
	//
	function makeReferenceArray(modelClass, arr, makeElements) {
		var elements = makeElements ? _.map(arr, function(element) {
			return new ModelElement(modelClass, element);
		}) : arr;

		return new ModelElementArray(modelClass, elements);
	}

	function joinElementArrays(arrays) {
		var combined = new ModelElementArray(arrays[0].modelClass, []);
		_.forEach(arrays, function(array) {
			AH.appendArray(combined, array);
		});
		return combined;
	}

	return {
		makeArray: makeReferenceArray,
		joinArrays: joinElementArrays
	};

});
/**
@class DataModel.Collection

A collection in an DataModel.Class.

The collection describes which DataModel.Class its elements consist of.

*/
define('DataModel/ModelCollection',[
	"AH",
	"underscore",
	"Constants",
	"../MDO/Error"
], function (
	AH,
	_,
	Constants,
	MdoError
	) {
	"use strict";

	// ### ModelCollection ##
	//
	// Class representing an MDM ModelCollection
	//
	function ModelCollection(modelClass, jsonCollection) {
		// Copy collection properties
		_.extend(this, jsonCollection);
		this.modelClass = modelClass;
	}

	/**
	 * @property {String} name
	 *
	 * Name of this collection.
	 */

	/**
	 * @property {DataModel.Class} modelClass
	 *
	 * {@link DataModel.Class} this collection belongs to.
	 */

	/**
	 * @property {String} colClassId
	 * @private
	 *
	 * {@link DataModel.Class#classId classId} of this collection's {@link DataModel.Collection#colClass colClass}.
	 */

	/**
	 * @property {Number} colParentId
	 * @private
	 *
	 * {@link DataModel.Field#fieldId fieldId} of this collection's {@link DataModel.Collection#colParent colParent}.
	 */

	/**
	 * @property {DataModel.Class} colClass
	 *
	 * {@link DataModel.Class} that the collection references.
	 */
	Object.defineProperty(ModelCollection.prototype, "colClass", {
		get: function () {
			if (!this._colClass) {
				this._colClass = this.modelClass.model.classes.getByClassId(this.colClassId);
			}

			return this._colClass;
		}
	});


	/**
	 * @property {DataModel.Field} colParent
	 *
	 * Foreign-key field in {@link DataModel.Collection#colClass colClass} that references this collection
	 * class's {@link DataModel.Class#idField idField}.
	 */
	Object.defineProperty(ModelCollection.prototype, "colParent", {
		get: function () {
			return this.colClass.fields.getByFieldId(this.colParentId);
		}
	});

	/**
	 * @class DataModel.CollectionArray
	 *
	 * Array of {DataModel.Collection} items.
	 */
	function ModelCollectionArray(modelClass, collections) {
		this.modelClass = modelClass;
		AH.appendArray(this, collections);
	}

	ModelCollectionArray.prototype = [];

	/**
	 * @method getByName
	 *
	 * Returns a {@link DataModel.Collection} based on its {@link DataModel.Collection#name name} property
	 *
	 * @param {String} name
	 *
	 * Identifies the collection
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the collection cannot be found.
	 *
	 * @returns {DataModel.Collection}
	 *
	 * Collection matching the specified `name`.
	 */
	ModelCollectionArray.prototype.getByName = function (name, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "name", name, throwErrorIfNotFound ? _.bind(throwError, this) : undefined);

		function throwError() {
			throw new MdoError("'" + this.modelClass.name + "." + name + "' model collection does not exist.", Constants.errorCodes.unknownModelCollection);
		}
	};

	// #### makeArray(modelClass, arr) ####
	//
	// Converts a regular array `arr` into a ModelCollectionArray
	// and converts the elements into instances of
	// `ModelCollection`.
	//
	// modelClass: The model class of the collections in 'arr'
	//
	function makeCollectionArray(modelClass, arr, makeCollections) {
		var collections = makeCollections ? _.map(arr, function (collection) {
			return new ModelCollection(modelClass, collection);
		}) : arr;

		return new ModelCollectionArray(modelClass, collections);
	}
    
	function joinCollectionArrays(arrays) {
		var combined = new ModelCollectionArray(arrays[0].modelClass, []);
		_.forEach(arrays, function(array) {
			AH.appendArray(combined, array);
		});
		return combined;
	}

	return {
		makeArray: makeCollectionArray,
		joinArrays: joinCollectionArrays
	};

});
/**
 * @class DataModel.Class
 *
 * A class in a {@link DataModel.Model}. The class describes an underlying database table.
 *
 * Accessed via {@link MDO.Element#mdoClass} and {@link MDO.Collection#mdoClass}.
 */
define('DataModel/ModelClass',[
	"AH",
	"underscore",
	"./ModelField",
	"./ModelElement",
	"./ModelCollection",
	"Constants",
	"../MDO/Error"
], function (
	AH,
	_,
	ModelField,
	ModelElement,
	ModelCollection,
	Constants,
	MdoError
	) {

	"use strict";

	// #### Type enumeration ###
	//
	// Stored in the `type` property
	//
	var Type = {
		Unknown: "Unknown",
		Record: "Record",
		File: "File",
		Folder: "Folder",
		Attribute: "Attribute",
		Message: "Message"
	};

	// ### ModelClass ##
	//
	// Class representing an MDM ModelClass
	//
	function ModelClass(model, cl) {
		// Copy over properties
		_.extend(this, cl);

		this.model = model;
	}

	/**
	 * @property {String} name
	 *
	 * Name of the model class
	 */

	/**
	 * @property {String} classId
	 *
	 * GUID identifying the model class
	 */

	/**
	 * @property {DataModel.Class} baseClass
	 *
	 * Class from which the current class derives, or `undefined`.
	 */

	/**
	 * @property {String} type
	 * @private
	 *
	 * Value indicating whether this is a special purpose model class.
	 *
	 * When `undefined`, the class is not a special purpose class.
	 * When `"File"`, the class is a file attachment class.
	 */

	/**
	 * @property {DataModel.FieldArray} fields
	 *
	 * List of database columns represented by this class.
	 */

	/**
	 * @property {DataModel.ElementArray} elements
	 *
	 * List of elements referenced by this class.
	 */

	/**
	 * @property {DataModel.CollectionArray} collections
	 *
	 * List of collections referencing this class.
	 */

	ModelClass.prototype.initClass = function () {
		this.baseClass = this.model.classes.getByClassId(this.baseId);
		// Inflate fields, elements and collections
		this.fields = ModelField.makeArray(this, this.fields, true);
		this.elements = ModelElement.makeArray(this, this.elements, true);
		this.collections = ModelCollection.makeArray(this, this.collections, true);
	};


	/**
	 * @method getSchema
	 * @private
	 *
	 * Returns the CREATE TABLE SQL statement for the class.
	 *
	 * @param {String} [name=class name]
	 *
	 * Name to use as the database table name. Overrides the model class name.
	 *
	 * @returns {string}
	 *
	 * `CREATE TABLE` SQL statement.
	 */
	ModelClass.prototype.getSchema = function (name) {

		var columns = [];
		for (var i = 0; i < this.fields.length; i++) {
			columns.push(this.fields[i].getSchema());
		}

		var sql = "CREATE TABLE " + (name || this.name) + " (" + columns.join(", ") + ")";
		return sql;
	};

	/**
	 * @method getEltOrFieldByName
	 *
	 * Returns a {@link DataModel.Field} or {@link DataModel.Element} with the matching name.
	 *
	 * @param {String} name
	 *
	 * Value to match
	 *
	 * @param {Boolean} throwErrorIfNotFound
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when a field or element cannot be found.
	 *
	 * @returns {DataModel.Field | DataModel.Element}
	 *
	 * Field or element matching the specified `name`.
	 */
	ModelClass.prototype.getEltOrFieldByName = function (name, throwErrorIfNotFound) {
		var eltOrField = this.allFields.getByName(name);
		if (!eltOrField) {
			eltOrField = this.allElements.getByName(name);
		}

		if (!eltOrField && throwErrorIfNotFound) {
			throw new MdoError("'" + this.name + "." + name + "' does not exist.", Constants.errorCodes.unknownModelField);
		}

		return eltOrField;
	};

	Object.defineProperties(ModelClass.prototype, {

		/**
		 * @property {DataModel.Class[]} inheritance
		 *
		 * Inheritance chain of this model class.  The first item in the array is this class, the second item
		 * its parent, etc.
		 */
		inheritance: {
			get: function () {
				// Lazily create and cache in this._inheritance
				if (!this._inheritance) {
					this._inheritance = [];
					/* eslint-disable consistent-this */
					var cl = this;
					/* eslint-enable consistent-this */
					while (cl) {
						this._inheritance.push(cl);
						cl = cl.baseClass;
					}
				}
				return this._inheritance;
			}
		},


		/**
		 * @property {DataModel.Class[]} derivedClasses
		 *
		 * List of classes whose {@link DataModel.Class#baseClass baseClass} property is the current class.
		 */
		derivedClasses: {
			get: function () {
				// Lazily create and cache in this._derived
				if (!this._derived) {
					this._derived = this.model.classes.filter(function (cl) {
						return cl.baseClass === this;
					}, this);
				}
				return this._derived;
			}
		},


		/**
		 * @property {DataModel.Field} idField
		 *
		 * Field representing the primary key in this class.
		 */
		idField: {
			get: function () {
				// Lazily create and cache in this._idField
				if (!this._idField) {
					this.fields.some(function (field) {
						if (field.isIdField()) {
							this._idField = field;
							return true;
						}
					}, this);
				}
				return this._idField;
			}
		},


		/**
		 * @property {DataModel.FieldArray} allFields
		 *
		 * List combining all {@link DataModel.Class#fields fields} in this class's {@link DataModel.Class#inheritance inheritance chain}.
		 */
		allFields: {
			get: function () {
				// Lazily create and cache in this._allFields
				if (!this._allFields) {

					if (this.inheritance.length === 1) {
						this._allFields = this.fields;
					} else {
						var fields = [];

						_.each(this.inheritance, function (inheritance, inheritanceIndex) {
							_.each(inheritance.fields, function (field) {
								// Only add Id field for the first iteration
								if (inheritanceIndex === 0 || !ModelField.isIdField(field)) {
									fields.push(field);
								}
							});
						});

						this._allFields = ModelField.makeArray(this, fields, false);
					}

				}

				return this._allFields;
			}
		},


		/**
		 * @property {DataModel.ElementArray} allElements
		 *
		 * List combining all {@link DataModel.Class#elements elements} in this class's {@link DataModel.Class#inheritance inheritance chain}.
		 */
		allElements: {
			get: function () {
				// Lazily create and cache in this._allElements
				if (!this._allElements) {
					if (this.inheritance.length === 1) {
						this._allElements = this.elements;
					} else {
						this._allElements = ModelElement.joinArrays(_.pluck(this.inheritance, "elements"));
					}
				}

				return this._allElements;
			}
		},


		/**
		 * @property {DataModel.CollectionArray} allCollections
		 *
		 * List combining all {@link DataModel.Class#collections collections} in this class's {@link DataModel.Class#inheritance inheritance chain}.
		 */
		allCollections: {
			get: function () {
				// Lazily create and cache in this._allCollections
				if (!this._allCollections) {
					if (this.inheritance.length === 1) {
						this._allCollections = this.collections;
					} else {
						this._allCollections = ModelCollection.joinArrays(_.pluck(this.inheritance, "collections"));
					}
				}

				return this._allCollections;
			}
		},


		/**
		 * @property {Boolean} isFileClass
		 *
		 * Indiciates whether the class represents a file attachment
		 */
		isFileClass: {
			get: function() {
				return this.type === Type.File;
			}
		}
	});


	/**
	 * @method getFieldFilter
	 * @private
	 *
	 * Return an object containing non-null `attributes` that correspond to the class's fields, including those
	 * inherited from base classes.
	 *
	 * @param {Object} attributes
	 *
	 * Attributes to be examined.
	 *
	 * @returns {Object}
	 *
	 * Subset of attributes that correspond to the class's fields.
	 */
	ModelClass.prototype.getFieldFilter = function (attributes) {
		var filter = this.inheritance.reduce(function (fields, cl) {
			return _.extend(fields, cl.pluckOwnAttributes(attributes));
		}, {});
		return filter;
	};

	/**
	 * @method pluckOwnAttributes
	 * @private
	 *
	 * Returns a subset of attributes that corresponding to fields in this class.
	 *
	 * @param {Object} attributes
	 *
	 * Attributes to be examined.
	 *
	 * @returns {Object}
	 *
	 * Subset of attributes that correspond to the class's fields.
	 */
	ModelClass.prototype.pluckOwnAttributes = function (attributes) {
		var plucked = {};
		var fields = this.fields;
		_.keys(attributes)
			.filter(function (name) {
				return fields.getByName(name);
			})
			.forEach(function (name) {
				plucked[name] = attributes[name];
			});
		return plucked;
	};


	/**
	 * @method getIdFilter
	 * @private
	 *
	 * Returns a filter based on `attributes` or `id` that correspond to the class's id field.
	 *
	 * @param {Object | Number} attributes
	 *
	 * Object containing class id field value or a numeric class id field value
	 *
	 * @returns {Object}
	 *
	 * Object representing id filter.
	 *
	 * @throws
	 *
	 * Error if `attributes` do not contain class id field
	 */
	ModelClass.prototype.getIdFilter = function (attributes) {
		var filter = {};
		this.fields.filter(ModelField.isIdField).forEach(function (field) {
			var name = field.name;
			var value = _.isObject(attributes) ? attributes[name] : attributes;
			if (_.isUndefined(value)) {
				throw new MdoError("value not defined for " + this.name + "." + name, Constants.errorCodes.missingValue);
			}
			filter[name] = value;
		}, this);

		return filter;
	};

	/**
	 * @class DataModel.ClassArray
	 *
	 * Array of {@link DataModel.Class} elements.
	 */
	function ModelClassArray(model, classes) {
		AH.appendArray(this, classes);

		model.classes = this;

		// Initialize inheritance (after the array has been fully populated and assigned to model!)
		_.each(this, function (cl) {
			cl.initClass();
		});
	}
    
	ModelClassArray.prototype = [];

	/**
	 * @method getByName
	 *
	 * Returns a {@link DataModel.Class} based on its {@link DataModel.Class#name name} property
	 *
	 * @param {String} name
	 *
	 * Identifies the class
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the class cannot be found.
	 *
	 * @returns {DataModel.Class}
	 *
	 * Class matching the specified `name`.
	 */
	ModelClassArray.prototype.getByName = function (name, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "name", name, throwErrorIfNotFound ? throwError : undefined);

		function throwError() {
			throw new MdoError("'" + name + "' model class does not exist.", Constants.errorCodes.unknownModelClass);
		}
	};


	/**
	 * @method getByClassId
	 *
	 * Returns a {@link DataModel.Class} based on its {@link DataModel.Class#classId classId} property
	 *
	 * @param classId
	 *
	 * Identifies the class
	 *
	 * @param {Boolean} [throwErrorIfNotFound=false]
	 *
	 * Indicates whether to throw and {Error} or return `undefined` when the class cannot be found.
	 *
	 * @returns {DataModel.Class}
	 *
	 * Class matching the specified `classId`.
	 */
	ModelClassArray.prototype.getByClassId = function (id, throwErrorIfNotFound) {
		return AH.cachedArrayLookup(this, "classId", id, throwErrorIfNotFound ? throwError : undefined);

		function throwError() {
			throw new MdoError("Id '" + id + "' model class does not exist.", Constants.errorCodes.unknownModelClass);
		}
	};

	// #### makeArray(arr) ####
	//
	// Converts a regular array `arr` into a ModelClassArray
	// and converts the elements into instances of
	// `ModelClass`.
	//
	function makeClassArray(model) {
		var classes = _.map(model.classes, function(cl) {
			return new ModelClass(model, cl);
		});
		return new ModelClassArray(model, classes);
	}


	return {
		makeArray: makeClassArray
	};
});
/**
 * @class DataModel.Model
 *
 * Information about the data store schema.
 *
 * Accessed via {@link MDO.Connection#model}.
 */
define('DataModel/Model',[
	"./ModelClass",
	"underscore",
	"Constants",
	"../MDO/Error"
], function (
	ModelClass,
	_,
	Constants,
	MdoError
	) {

	"use strict";

	function Model(src) {
		if (_.isString(src)) {
			src = JSON.parse(src);
		}

        // Copy over properties
		_.extend(this, src);
		
		if (_.isArray(this.classes)) {
			// Process Classes
			ModelClass.makeArray(this);
		}
	}

	/**
	 * @property {DataModel.ClassArray} classes
	 *
	 * List of classes represented in the model
	 */

	/**
	 * @property {String} name
	 *
	 * Name of the data store this model belongs to
	 */

	/**
	 * @property {Number} version
	 *
	 * Current version of this data model.
	 */

	// ### Model.compareTo(newModel)
	// Performs a diff against newModel and finds classes to create, alter, and delete
	//
	// returned diff object:
	//
	//  {
	//		classesToCreate: [<classIds>],
	//		classesToDelete: [<classIds>],
	//		classesToAlter: [<classIds>]
	// }
	//
	Model.prototype.compareTo = function compareTo(newModel) {

		var self = this;
		var diff = {};

		if (!newModel || !newModel.classes) {
			throw new MdoError("Cannot compare to an invalid model.", Constants.errorCodes.invalidArgs);
		}

		var myClasses = _.pluck(self.classes, "classId");
		var newClasses = _.pluck(newModel.classes, "classId");

		diff.classesToCreate = _.difference(newClasses, myClasses);
		diff.classesToDelete = _.difference(myClasses, newClasses);

		var commonClasses = _.intersection(myClasses, newClasses);
		diff.classesToAlter = _.filter(commonClasses, function(classId) {

			var myClass = getClassInfo(self.classes.getByClassId(classId));
			var newClass = getClassInfo(newModel.classes.getByClassId(classId));

			return !_.isEqual(myClass, newClass);

			// ### getClassInfo(modelClass)
			//
			// Builds an object that contains the relevant class information that
			// is needed to determine if there are any differences in the two
			// models that are being compared
			//
			// returns:
			// {
			//		name: <modelClass.name>,
			//		<field1.fieldId> : <field1.name>,
			//		...
			//		<fieldN.fieldId> : <fieldN.name>
			// }

			function getClassInfo(modelClass) {

				// @todo: update this function to include for field type information (Case 4852),

				var info = {
					name: modelClass.name
				};

				_.each(modelClass.fields, function(field) {
					info[field.fieldId] = field.name;
				});

				return info;
			}
		});

		return diff;
	};

	// ## Public Exports

	// ### fromString(text) ###
	// Loads a model from strinfied JSON representation
	function fromString(text) {

		return new Model(text);
	}

	return {
		fromString: fromString
	};

});
/**
 * @class MDO.Stats
 * @singleton
 *
 * MDO execution statistics.
 *
 * Exposed through {@link MDO.Client#stats}.
 */
define('MDO/Stats',[
	"underscore",
	"backbone",
	"AH"
], function (
	_,
	Backbone,
	AH
	) {
	"use strict";

	var current;
	var lastSnapshotId = 0;

	/**
	 * @method now
	 *
	 * Returns a milliseconds value that can be used for calculating elapsed time.
	 *
	 * In browsers supporting the `performance` API, this will be a high-resolution timestamp.
	 * In other browsers, this will be a Date timestamp.
	 *
	 * @returns {number}
	 */
	var now = (_.isObject(window.performance) && _.isFunction(window.performance.now))
		? _.bind(window.performance.now, window.performance) : _.bind(Date.now, Date);

	/*
	 * @method queryCount
	 *
	 * Returns total number of database queries that have been executed so far.
	 * This method can be used even when Stats are disabled.
	 *
	 * @returns {number}
	 */
	function queryCount() {
		return AH.websql.queryCount();
	}

	/*
	 * @method serverQueryCount
	 *
	 * Returns total number of server queries that have been executed so far.
	 * This method can be used even when Stats are disabled.
	 *
	 * @returns {number}
	 */
	function serverQueryCount() {
		return require("Data/Server").queryCount();
	}

	/**
	 * @method snapshot
	 *
	 * Returns a snapshot containing the current statistics.  Enables Stats if currently disabled.
	 *
	 * @return {MDO.Stats.Snapshot}
	 *
	 * Snapshot information
	 */
	function snapshot() {
		if (!current) {
			startTracking();
		}
		// Create a deep-copy of current stats
		var info = _.extend(new Snapshot(), JSON.parse(JSON.stringify(current)));

		// Now add some useful stuff.
		info.id = ++lastSnapshotId;
		info.ts = now();
		info.queryCount = queryCount();
		info.serverQueryCount = serverQueryCount();

		return info;
	}

	/**
	 * @method diff
	 *
	 * Returns the difference between two snapshots.
	 *
	 * @param oldSnapshot
	 *
	 * Older snapshot
	 *
	 * @param [newSnapshot=snapshot()]
	 *
	 * Newer snapshot.  When not specified, the current execution snapshot is used
	 *
	 * @return {MDO.Stats.SnapshotDiff}
	 *
	 * Snapshot difference object
	 */
	function diff(oldSnapshot, newSnapshot) {
		if (!oldSnapshot || !oldSnapshot.stats) {
			throw new Error("oldSnapshot is not a Snapshot");
		}
		newSnapshot = newSnapshot || current;
		if (!newSnapshot || !newSnapshot.stats) {
			throw new Error("newSnapshot is not a Snapshot");
		}

		var info = _.extend(new SnapshotDiff(), {
			from: { ts: oldSnapshot.ts, id: oldSnapshot.id },
			to: { ts: newSnapshot.ts || now(), id: newSnapshot.id },
			stats: {}
		});

		// Elapsed time (in ms)
		info.elapsed = (newSnapshot.ts || now()) - oldSnapshot.ts;
		info.queryCount = (newSnapshot.queryCount || queryCount()) - oldSnapshot.queryCount;
		info.serverQueryCount = (newSnapshot.serverQueryCount || serverQueryCount()) - oldSnapshot.serverQueryCount;

		var oldStats = oldSnapshot.stats;
		var newStats = newSnapshot.stats;

		var ops = _.union(_.keys(oldStats), _.keys(newStats)).sort();
		_.forEach(ops, function(op) {
			var oldOpData = oldStats[op] || {};
			var newOpData = newStats[op] || {};
			var classes = _.union(_.keys(oldOpData), _.keys(newOpData)).sort();
			var diffOpData;
			_.forEach(classes, function(cl) {
				var delta = (newOpData[cl] || 0) - (oldOpData[cl] || 0);
				if (delta) {
					diffOpData = diffOpData || (info.stats[op] = {});
					diffOpData[cl] = delta;
				}
			});
		});

		return info;
	}

	/**
	 * @method updateStat
	 *
	 * Update statistic count.
	 *
	 * @param {String} op
	 *
	 * Operation, e.g.: `"CREATE"`, `"READ"`, `"UPDATE"`, `"DELETE"`
	 *
	 * @param {String} modelClass
	 *
	 * Name of affected model class
	 *
	 * @param {Number} [delta=1]
	 *
	 * Value by which to adjust statistic
	 *
	 * @returns {void}
	 */
	function updateStat(op, modelClass, delta) {
		if (!current) {
			// Not collecting statistics
			return;
		}
		var stats = current.stats;
		var classes = stats[op] || (stats[op] = {});
		if (_.isUndefined(delta)) {
			delta = 1;
		}
		// Update model class
		classes[modelClass] = (classes[modelClass] || 0) + delta;
		// Update total
		classes.$all = (classes.$all || 0) + delta;
	}

	/**
	 * @class MDO.Stats.Snapshot
	 *
	 * Object containing current execution statistics.
	 */
	function Snapshot() {}

	/**
	 * @property {Number} id
	 *
	 * ID identifying the snapshot.
	 */

	/**
	 * @property {Number} ts
	 *
	 * Timestamp when snapshot was taken
	 */

	/**
	 * @property {Number} queryCount
	 *
	 * Total number of SQL queries that have been executed
	 */

	/**
	 * @property {Number} serverQueryCount
	 *
	 * Total number of server queries that have been executed
	 */

	/**
	 * @property {Object} stats
	 *
	 * Statistics about this snapshot in the following format:
	 *
	 *      {
	 *          "CREATE": {  // Records inserted into the database (MDO.Element.save())
	 *              "$all": 2,
	 *              "Class1": 2
	 *          },
	 *          "READ": {  // Records read from the database (MDO.Element.fetch()/resolve() and MDO.Collection.fetch())
	 *              "$all": 12,
	 *              "Class1": 5,
	 *              "Class2": 7
	 *          },
	 *          "DELETE": {  // Records deleted from the database (MDO.Element.destroy())
	 *              ...
	 *          },
	 *          "UPDATE": {  // Records updated in the database (MDO.Element.save())
	 *              ...
	 *          }
	 *      }
	 */

	Snapshot.prototype.toString = function() {
		var lines = [];
		lines.push("[Snapshot " + this.id + " (" + this.ts + ")]");
		lines.push("Local Queries:  " + this.queryCount);
		lines.push("Server Queries: " + this.serverQueryCount);
		_.forEach(_.keys(this.stats).sort(), function(op) {
			lines.push(op);
			var opData = this.stats[op];
			var classes = _.keys(opData).sort();
			_.forEach(classes, function(cl) {
				lines.push("  " + cl + ": " + opData[cl]);
			});
		}, this);
		return lines.join("\n");
	};

	/**
	 * @class MDO.Stats.SnapshotDiff
	 *
	 * Difference between two Snapshots.
	 */
	function SnapshotDiff() {}

	/**
	 * @property {Number} elapsed
	 *
	 * Number of milliseconds between the snapshots
	 */

	/**
	 * @property {Number} queryCount
	 *
	 * Number of SQL queries that have been executed
	 */

	/**
	 * @property {Number} serverQueryCount
	 *
	 * Number of server queries that have been executed
	 */

	/**
	 * @property {Object} from
	 *
	 * Information about older snapshot.
	 *
	 * @property {Number} from.ts
	 *
	 * Timestamp when older snapshot was taken
	 *
	 * @property {Number} from.id
	 *
	 * Id of the starting Snapshot.
	 */

	/**
	 * @property {Object} to
	 *
	 * Information about newer snapshot.
	 *
	 * @property {Number} to.ts
	 *
	 * Timestamp when newer snapshot was taken
	 *
	 * @property {Number} to.id
	 *
	 * Id of newer snapshot, or `undefined` if newer snapshot was not specified.
	 */

	/**
	 * @property {Object} stats
	 *
	 * Statistics about the difference between the snapshots in the following format:
	 *
	 *      {
	 *          "CREATE": {  // Records inserted into the database (MDO.Element.save())
	 *              "$all": 2,
	 *              "Class1": 2
	 *          },
	 *          "READ": {  // Records read from the database (MDO.Element.fetch()/resolve() and MDO.Collection.fetch())
	 *              "$all": 12,
	 *              "Class1": 5,
	 *              "Class2": 7
	 *          },
	 *          "DELETE": {  // Records deleted from the database (MDO.Element.destroy())
	 *              ...
	 *          },
	 *          "UPDATE": {  // Records updated in the database (MDO.Element.save())
	 *              ...
	 *          }
	 *      }
	 */

	SnapshotDiff.prototype.toString = function() {
		return this.format();
	};

	/**
	 * @method format
	 *
	 * Formats the snapshot for display.
	 *
	 * @param {String} [fmt="full"]
	 *
	 * Format to use:
	 *
	 *  * `"short"`
	 *      Single-line display.
	 *
	 *  * `"long"`
	 *      Multi-line display.
	 *
	 *  * `"full"`
	 *      Multi-line display with title.
	 *
	 * @returns {string}
	 */
	SnapshotDiff.prototype.format = function(fmt) {
		if (fmt === "short") {
			var info = [];
			if (this.queryCount) {
				info.push("LQ " + this.queryCount);
			}
			if (this.serverQueryCount) {
				info.push("SQ " + this.serverQueryCount);
			}
			_.forEach(this.stats, function(val, key) {
				var cnt = val.$all;
				if (cnt) {
					var label = key.replace(/(\w)(?:\w*)(?:-?)/g, "$1");
					info.push(label + " " + cnt);
				}
			});
			return info.join(", ");
		}

		var lines = [];
		if (fmt === "full") {
			lines.push("[Snapshot Diff (" + this.from.id + " -> " + (this.to.id || "current") + ")] " + (this.elapsed / 1000).toFixed(3) + "s");
		}
		if (this.queryCount) {
			lines.push("Local Queries:  " + this.queryCount);
		}
		if (this.serverQueryCount) {
			lines.push("Server Queries: " + this.serverQueryCount);
		}
		_.forEach(_.keys(this.stats).sort(), function(op) {
			lines.push(op);
			var opData = this.stats[op];
			var classes = _.keys(opData).sort();
			_.forEach(classes, function(cl) {
				lines.push("  " + cl + ": " + opData[cl]);
			});
		}, this);
		return lines.join("\n");
	};

	/**
	 * @class MDO.Stats
	 */

	/* *
	 * @method startTracking
	 * @private
	 *
	 * Enables statistics tracking
	 *
	 */
	function startTracking() {
		current = { stats: {} };
	}

	/* *
	 * @method stopTracking
	 * @private
	 *
	 * Disables statistics tracking
	 *
	 */
	function stopTracking() {
		current = undefined;
	}

	var exports = {
		now: now,
		snapshot: snapshot,
		diff: diff,
		updateStat: updateStat,
		reset: function() {
			lastSnapshotId = 0;
			current = undefined;
		}
	};

	Object.defineProperties(exports, {

		/**
		 * @property {boolean} enabled
		 *
		 * Indicates whether statistics tracking is currently enabled
		 */
		enabled: {
			get: function() {
				return Boolean(current);
			},
			set: function(val) {
				if (val && !current) {
					startTracking();
				} else if (current && !val) {
					stopTracking();
				}
			}
		},

		/**
		 * @property {Number} queryCount
		 * @readonly
		 *
		 * Total number of database queries that have been executed so far.
		 * This property can be used even when Stats are disabled.
		 */
		queryCount: {
			get: queryCount
		},

		/**
		 * @property {Number} serverQueryCount
		 * @readonly
		 *
		 * Total number of server queries that have been executed so far.
		 * This property can be used even when Stats are disabled.
		 *
		 * @returns {number}
		 */
		serverQueryCount: {
			get: serverQueryCount
		}
	});

	return exports;
});

// Data/TempId/TempIdRow
//
// Caches temp ids to reduce database access.
//
// ## Model Attributes
//
//  * sequence
//  * permid
//  * tempid
//  * timestamp (ts)
//
define('Data/TempId/TempIdRow',[
	"underscore",
	"backbone",
	"AH"
], function (
	_,
	Backbone,
	AH
	) {

	"use strict";

	var TempIdRow = Backbone.Model.extend({

		idAttribute: "tempid",

		sync: function (method, model, options) {
			var self = this;

			function onSuccess(resp) {
				options.success(resp);
				return AH.resolve(self);
			}

			function onError(err) {
				return AH.reject(err);
			}

			// ### createUpdate(sequence, tempid, permid)
			//
			// Insert row into the database
			//
			// If `options.xact` exists, execute SQL within that database transaction
			// otherwise execute SQL within its own database transaction
			//
			function createUpdate(sequence, tempid, permid) {
				var sql = 'INSERT OR REPLACE INTO "@tempid" (sequence, tempid, permid) VALUES (?, ?, ?)';
				var args = [sequence, tempid, permid];

				if (options.xact) {
					var dfd = AH.defer();
					options.xact.executeSql(sql, args, function (xact, rs) {
						dfd.resolve(getResult(rs));
					}, function (xact, err) {
						dfd.reject(err);
					});
					return dfd.promise;
				}

				return self.collection._db.execute(sql, args)
					.then(getResult);

				function getResult(rs) {
					return {
						id: rs.insertId,
						sequence: sequence,
						tempid: tempid,
						permid: permid
					};
				}
			}

			switch (method) {
				case "update":
					return createUpdate(this.attributes.sequence, this.attributes.tempid, this.attributes.permid)
						.then(onSuccess, onError);
				default:
					return AH.reject(new Error("TempIdRow sync method not implemented: " + method));
			}
		}
	});

	return TempIdRow;
});

// Data/TempIdCache
//
// Caches temp ids to reduce database access.
//
// The cache will keep all temp ids in memory until a call to emptyTempIdCache is made. Calls to purgeTempIdCache
// remove those entries from disk, but the cache maintains a reference to them.
//
define('Data/TempId/TempIdCache',[
	"./TempIdRow",
	"underscore",
	"backbone",
	"AH"
], function (
	TempIdRow,
	_,
	Backbone,
	AH
	) {

	"use strict";

	var TempIdCache = Backbone.Collection.extend({

		// ## _seriesColumnExists ()
		//
		// Returns a promise that resolves with true if the @tempid table
		//  is defined and has a 'series' column.
		//
		_seriesColumnExists: function () {
			return this._db.tableExists("@tempid").then(function (table) {
				return !table
					? false
					: table.sql.indexOf("series") > -1;
			});
		},

		model: TempIdRow,

		// ## initialize ()
		//
		// Options:
		//  database (required): sql database that will be used to store the @tempid table
		//
		//
		// Create temp id table and store the promise
		//	id: autogenerated increasing id
		//	sequence: inSeqNum when tempId was resolved
		//	tempid: temp ID
		//	permid: permanent ID
		//	ts: timestamp when xact was created
		//
		initialize: function (attributes, options) {
			var self = this;
			options = options || {};
			this._db = options.database;
			var tableName = "@tempid";
			var createTable = 'CREATE TABLE IF NOT EXISTS "{0}" (id INTEGER PRIMARY KEY ASC, sequence INTEGER NOT NULL, tempid INTEGER NOT NULL, permid INTEGER NOT NULL, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (tempid))';
			this._tablePromise = this._seriesColumnExists().then(function (exists) {
				if (exists) {
					return self._db.transaction(function (xact) {
						var tempTableName = "@tempidCOPY";
						var insertInto = 'INSERT INTO "{0}" SELECT id, sequence, tempid, permid, ts FROM "{1}"';
						var dropTable = 'DROP TABLE "{0}"';
						xact.executeSql(AH.format(createTable, tempTableName));
						xact.executeSql(AH.format(insertInto, tempTableName, tableName));
						xact.executeSql(AH.format(dropTable, tableName));
						xact.executeSql(AH.format(createTable, tableName));
						xact.executeSql(AH.format(insertInto, tableName, tempTableName));
						xact.executeSql(AH.format(dropTable, tempTableName));
					});
				}

				return self._db.transaction(function (xact) {
					xact.executeSql(AH.format(createTable, tableName));
				});
			});
		},
		// ## fetch()
		//
		// Load the collection from the database replacing
		// uncommited changes.
		//
		// Returns a deferred promise.
		//
		// Note: Implemented by overriding the Backbone.sync() method

		// ### sync (method, model, options)
		//
		// Implements reading tempId's from the data store
		//
		// Returns a promise that resolves when the operation is completed
		//
		sync: function (method, model, options) {
			var db = this._db;
			var self = this;

			function onSuccess(resp) {
				options.success(resp);
				return AH.resolve(self);
			}

			function onError(err) {
				return AH.reject(err);
			}

			function read() {
				return db.read('SELECT * FROM "@tempid"', function (rs) {
					var result = [];
					var rows = rs.rows;
					for (var i = 0; i < rows.length; i++) {
						result.push(rows.item(i));
					}
					return result;
				});
			}

			switch (method) {
				case "read":
					return this._tablePromise.then(read)
					.then(onSuccess, onError);
				default:
					return AH.reject(new Error("TempIdCache sync method not implemented: " + method));
			}
		},

		comparator: function (a, b) {
			return b.attributes.tempid - a.attributes.tempid; // tempid are negative, so we've switched the order.
		},

		// ## purgeTempIdCache(maxSeqNum)
		//
		// Delete tempids whose sequence is <= `maxSeqNum` from the table
		//
		// Returns a promise
		//
		purgeTempIdCache: function (maxSeqNum) {
			return this._tablePromise.then(_.bind(function () {
				return this._db.execute('DELETE FROM "@tempid" WHERE sequence <= ?', [maxSeqNum]).then(_.bind(function () {
					return this;
				}, this));
			}, this));
		},

		// ## emptyTempIdCache()
		//
		// Delete all tempids from the cache and from the table
		//
		// Returns a promise
		//
		emptyTempIdCache: function () {
			return this._tablePromise.then(_.bind(function () {
				return this._db.execute('DELETE FROM "@tempid"').then(_.bind(function () {
					return this.fetch();
				}, this));
			}, this));
		},

		// ## resolveTempId(tempid)
		//
		// If it exists, return the permanent id for the given tempid.
		// Otherwise, return the tempid.
		//
		resolveTempId: function (tempid) {
			var row = this.get(tempid);
			if (row) {
				return row.get("permid");
			}
			return tempid;
		}
	});

	return TempIdCache;
});

define('Settings/Storage',[
	"underscore",
	"AH",
	"lib/Class"
], function(
	_,
	AH,
	Class
	) {

	"use strict";

	return Class.extend({
		// ## initialize(db, tableName)
		//
		// Opens the given database and reads/writes data to/from the settings table 'tableName'.
		// If the 'tableName' table doesn't not exist, it will be created.
		//
		initialize: function(db, tableName) {
			this._tableName = tableName;

			this._db = db;
			this._openPromise = this._db.promise
				.then(_.bind(this._createSettingsTable, this));

			this._openPromise.then(null, function () {
				this._db = undefined;
			});
		},

		//
		// Creates the settings table if it doesn't already exist
		//
		_createSettingsTable: function() {
			return this._db.execute('CREATE TABLE IF NOT EXISTS "' + this._tableName + '" (Key NOT NULL, Value, UNIQUE( Key ))');
		},

		// ## getItem(key)
		//
		// Returns the value for the given 'key', or null if the key does not exist (it has never been set).
		//
		getItem: function(key) {
			return this._openPromise.then(_.bind(function() {
				return this._db.read('SELECT Value FROM "' + this._tableName + '" WHERE Key = ?', [key])
					.then(function(rs) {
						if (rs.rows.length === 0) {
							return null;
						}

						// Unique constraint guarantees there was only one match
						return rs.rows.item(0).Value;
					});
			}, this));
		},

		// ## getAllItems()
		//
		// Returns an object representing all of the key-value pairs, or an empty object if no key-value pairs exist.
		//
		// Example:
		//		{ "Key1": 1, "Key2": "example value" }
		//
		getAllItems: function() {
			return this._openPromise.then(_.bind(function() {
				return this._db.read('SELECT Key, Value FROM "' + this._tableName + '"')
					.then(function(rs) {
						if (rs.rows.length === 0) {
							return {};
						}

						var items = {};
						for (var i = 0; i < rs.rows.length; i++) {
							var item = rs.rows.item(i);

							items[item.Key] = item.Value;
						}

						return items;
					});
			}, this));
		},

		// ## setItem(key, value)
		//
		// Creates/Upates a 'key' with the given 'value'. If the value is a javascript object, the value will be stringified.
		//
		setItem: function(key, value) {
			return this._openPromise.then(_.bind(function() {
				if (_.isObject(value)) {
					value = JSON.stringify(value);
				}

				return this._db.execute('INSERT OR REPLACE INTO "' + this._tableName + '" (Key, Value) VALUES(?, ?)', [key, value])
					.then(function() {
						return value;
					});
			}, this));
		},

		// ## removeItem(key)
		//
		// Removes the given 'key' and its value from storage.
		//
		removeItem: function(key) {
			return this._openPromise.then(_.bind(function() {
				return this._db.execute('DELETE FROM "' + this._tableName + '" WHERE Key = ?', [key]);
			}, this));
		},

		// ## removeAllItems()
		//
		// Removes all of the current keys and their values from storage.
		//
		removeAllItems: function() {
			return this._openPromise.then(_.bind(function() {
				return this._db.execute('DELETE FROM "' + this._tableName + '"');
			}, this));
		}
	});
});
define('Settings/StorageWrapper',[
	"underscore",
	"AH",
	"lib/Class"
], function (
	_,
	AH,
	Class
	) {

	"use strict";

	return Class.extend({
		// ## initialize(storage, properties, defaults)
		//
		// Extends a `storage` object with setter and getter methods
		// based on strings in `properties`.
		//
		// * properties are stored as object properties in `storage`
		// * defaults specifies the default values for `properties` (e.g. { key: defaultValue })
		//
		initialize: function (storage, properties, defaults) {
			this._settings = {};
			this._defaults = defaults || {};

			this._storage = storage;

			this._createPropertyAccessors(properties);

			this._isLoaded = false;
		},

		// ## load()
		//
		// Loads and caches all of the key-value pairs from storage.
		//
		load: function() {
			var self = this;

			return this._storage.getAllItems()
				.then(function(items) {
					self._settings = items;
					self._isLoaded = true;
				});
		},

		// ## getAllItems()
		//
		// Returns an object representing all of the key-value pairs, or an empty object if no key-value pairs exist.
		//
		// Example:
		//		{ "Key1": 1, "Key2": "example value" }
		//
		getAllItems: function() {
			return _.clone(this._settings);
		},

		//
		// Creates the getter and setter functions for the given `properties`.
		//
		// Usage:
		//	properties - ["id", "name"]
		//
		//	this.id("UniqueId");
		//	this.id() === "UniqueId";
		//
		//	this.name("Test");
		//	this.name() === "Test";
		//
		_createPropertyAccessors: function(properties) {
			var self = this;

			if (properties) {
				_.each(properties, function (propName) {
					makeAccessor(propName);
				});
			}

			function makeAccessor(propName) {
				self[propName] = function(value) {
					if (value === undefined) {
						return get();
					}

					return set(value);
				};

				function get() {
					self._throwIfNotLoaded();

					return _.isUndefined(self._settings[propName]) ? self._getDefaultValueOrNull(propName) : self._settings[propName];
				}

				function set(value) {
					return self._storage.setItem(propName, value)
						.then(function(val) {
							if (val === null) {
								delete self._settings[propName];
								return undefined;
							}

							return (self._settings[propName] = val);
						});
				}
			}
		},

		//
		// Returns the default value for the property with the given `name` or null if no default value exists.
		//
		_getDefaultValueOrNull: function(name) {
			return _.isUndefined(this._defaults[name]) ? null : this._defaults[name];
		},

		//
		// Throws an error if the storage key-value pairs have not been loaded into memory.
		//
		_throwIfNotLoaded: function() {
			if (!this._isLoaded) {
				throw new Error("Storage items have not been loaded");
			}
		},

		// ## clear()
		//
		// Clears all values from storage.
		//
		clear: function () {
			return this._storage.removeAllItems()
				.then(_.bind(function() {
					this._settings = {};
				}, this));
		},

		// ## isEmpty()
		//
		// Returns true if no key-value pairs exist in storage.
		//
		isEmpty: function() {
			this._throwIfNotLoaded();

			return _.isEmpty(this._settings);
		}
	});
});
define('Settings/Datastore',[
	"./Storage",
	"./StorageWrapper",
	"underscore",
	"AH"
], function (
	Storage,
	StorageWrapper,
	_,
	AH
	) {

	"use strict";

	/** @class Settings.DataStore
	 * @private
	 *
	 * * id
	 * * name
	 * * modelId
	 * * modelVersion
	 * * inSeriesId
	 * * outSeriesId
	 * * inSeqNum
	 * * outSeqNum
	 * * nextTempId
	 */
	var Datastore = StorageWrapper.extend({
		initialize: function (db) {
			var storage = new Storage(db, "@settings");
			StorageWrapper.prototype.initialize.call(this,
				storage,
				[
					"id",
					"name",
					"model",
					"modelId",
					"modelVersion",
					"inSeriesId",
					"outSeriesId",
					"inSeqNum",
					"outSeqNum",
					"nextTempId"
				]);

			this._previousTempIdPromise = AH.resolve();
		},

		// ## settings.generateNextTempId()
		//
		// Decrements the nextTempId and returns its new value.
		//
		// Returns a promise that resolves with the generated tempId.
		//
		generateNextTempId: function () {
			var self = this;
			var dfd = AH.defer();

			this._previousTempIdPromise.always(generateNewTempId);

			return (this._previousTempIdPromise = dfd.promise);

			function generateNewTempId() {
				AH.chainPromise(self.nextTempId(self.nextTempId() - 1), dfd);
			}
		},

		// ## settings.importSettingsFromDsInfo()
		//
		// Imports existing settings from a DatastoreInfo object
		//
		//
		importSettingsFromDsInfo: function(dsInfo) {
			var self = this;
			var settingsToImport = [
				"id",
				"name",

				// settings to delete
				"modelId",
				"modelVersion",
				"inSeriesId",
				"inSeqNum",
				"outSeriesId",
				"outSeqNum",
				"nextTempId"
			];

			var settingsToDelete = _.rest(settingsToImport, 2);

			var promise;

			_.each(settingsToImport, function(setting) {
				promise = AH.when(promise)
					.then(function() {
						return self[setting](dsInfo[setting]());
					});
			});

			return promise
				.then(clearDsInfoSettings);

			function clearDsInfoSettings() {
				_.each(settingsToDelete, function(setting) {
					dsInfo[setting](null);
				});
			}
		}
	});

	Object.defineProperties(Datastore.prototype, {
		incomingMtlFilePattern: {
			get: function() {
				if (this.outSeriesId() === null) {
					throw new Error("No 'outSeriesId' has been set");
				}

				return this.outSeriesId() + ".*.MTL";
			}
		},
		outgoingMtcFilePattern: {
			get: function() {
				if (this.inSeriesId() === null) {
					throw new Error("No 'inSeriesId' has been set");
				}

				return this.inSeriesId() + ".*.mtc";
			}
		}
	});

	return Datastore;
});
define('Files/fileSystem',[
	"AH",
	"underscore"
], function (
	AH,
	_
	) {

	"use strict";

	/**
	 * @class Files.FileSystem
	 * @private
	 *
	 * Represent a file system on top of the HTML File System API or the Native File System API.
	 * The module falls back on the HTML File System API if no Native File System API is available.
	 *
	 * All operations are asynchronous and return a deferred promise.
	 */
	return (function () {
		// Enum for indicating the level
		// of support the file system module provides
		var SupportLevels = {
			// Files will be stored in
			// the native layer using Cordova (PhoneGap)
			Native: "Native",

			// Files will be stored using the HTML
			// File System API http://www.w3.org/TR/file-system-api/
			Browser: "Browser",

			// No file system support is available
			None: "None"
		};

		var USAGE_INFO_QUOTA_INDEX = 1;

		var supportLevel;

		var requestFileSystem;
		var fileSystem;
		var normalizeDataForWrite;

		var requestQuota;
		var queryUsageAndQuota;

		var notSupportedRejectedPromise = AH.reject(new Error("File System API is not supported."));
		var closedRejectedPromise = AH.reject(new Error("File system is closed."));

		// The open promise starts off in a rejected state
		var openPromise = closedRejectedPromise;

		// The amount of additional quota that will be requested (1GB)
		// when we receive a 'QUOTA_EXCEEDED_ERR' from the HTML File System API
		//
		// This doesn't apply to the Native API.
		var QUOTA_SIZE_INCREASE = 1024 * 1024 * 1024;

		// The amount of initial quota that will be requested.
		// This is ignored by Native API.
		var initialQuota = QUOTA_SIZE_INCREASE;

		// List taken from: https://github.com/mrlacey/phonegap-wp7/blob/master/framework/PhoneGap/Commands/MimeTypeMapper.cs
		// Added pdf to the list.
		var defaultMimeType = "application/octet-stream";
		var mimeTypes = {
			"avi": "video/x-msvideo",
			"bmp": "image/bmp",
			"gif": "image/gif",
			"jpe": "image/jpeg",
			"jpeg": "image/jpeg",
			"jpg": "image/jpeg",
			"mov": "video/quicktime",
			"mp2": "audio/mpeg",
			"mp3": "audio/mpeg",
			"mp4": "video/mp4",
			"mpe": "video/mpeg",
			"mpeg": "video/mpeg",
			"mpg": "video/mpeg",
			"mpga": "audio/mpeg",
			"pbm": "image/x-portable-bitmap",
			"pcm": "audio/x-pcm",
			"pct": "image/pict",
			"pdf": "application/pdf",
			"pgm": "image/x-portable-graymap",
			"pic": "image/pict",
			"pict": "image/pict",
			"png": "image/png",
			"pnm": "image/x-portable-anymap",
			"pnt": "image/x-macpaint",
			"pntg": "image/x-macpaint",
			"ppm": "image/x-portable-pixmap",
			"qt": "video/quicktime",
			"ra": "audio/x-pn-realaudio",
			"ram": "audio/x-pn-realaudio",
			"ras": "image/x-cmu-raster",
			"rgb": "image/x-rgb",
			"snd": "audio/basic",
			"txt": "text/plain",
			"tif": "image/tiff",
			"tiff": "image/tiff",
			"wav": "audio/x-wav",
			"wbmp": "image/vnd.wap.wbmp"
		};

		// ## getSupportLevel()
		//
		// Returns the level of support that the file system module provides (i.e. which API will be used to store/retrieve files).
		//
		function getSupportLevel() {
			if (supportLevel) {
				// Return the support level that was 'locked-in' when the file system module was opened/initialized
				return supportLevel;
			}

			if (window.cordova && window.requestFileSystem) {
				return SupportLevels.Native;
			} else if (window.webkitRequestFileSystem || window.requestFileSystem) {
				return SupportLevels.Browser;
			}

			return SupportLevels.None;
		}

		var captureAndWrapBrowserAPI = _captureAndWrapBrowserAPI;
		function _captureAndWrapBrowserAPI() {
			var PERSISTENT = window.PERSISTENT;

			if (navigator.webkitPersistentStorage) {
				// Wrap requestQuota method with a promise based api
				requestQuota = AH.bindCallViaCallbacks(navigator.webkitPersistentStorage.requestQuota, navigator.webkitPersistentStorage);

				// Wrap queryUsageAndQuota method with a promise based api
				queryUsageAndQuota = AH.bindCallViaCallbacks(navigator.webkitPersistentStorage.queryUsageAndQuota, navigator.webkitPersistentStorage);
			} else {
				// Wrap requestQuota method with a promise based api
				requestQuota = AH.bindCallViaCallbacks(window.webkitStorageInfo.requestQuota, window.webkitStorageInfo, PERSISTENT);

				// Wrap queryUsageAndQuota method with a promise based api
				queryUsageAndQuota = AH.bindCallViaCallbacks(window.webkitStorageInfo.queryUsageAndQuota, window.webkitStorageInfo, PERSISTENT);
			}

			normalizeDataForWrite = normalizeDataForHtmlWrite;

			// Wrap requestFileSystem method with a promise based api
			requestFileSystem = AH.bindCallViaCallbacks(window.webkitRequestFileSystem || window.requestFileSystem, window, PERSISTENT);
		}

		function captureAndWrapNativeAPI() {
			// Using native based file system
			requestFileSystem = window.requestFileSystem;

			normalizeDataForWrite = normalizeDataForNativeWrite;

			// Wrap requestFileSystem method with a promise based api
			requestFileSystem = AH.bindCallViaCallbacks(requestFileSystem, window, window.LocalFileSystem.PERSISTENT);
		}

		// ## open()
		//
		// Initializes the file system module.
		// If the HTML API is used, then a request for the initial quota
		// amount will be made and the user will be prompted for approval.
		//
		// Returns a promise that resolves if the file system module was initialized successfully.
		//
		var open = _open;
		function _open() {
			// Make sure that calling 'open' more than once returns the same promise,
			// unless the previous call failed
			if (openPromise !== closedRejectedPromise) {
				return openPromise;
			}

			// Lock in the support level, when opened
			supportLevel = getSupportLevel();

			if (supportLevel === SupportLevels.None) {
				return notSupportedRejectedPromise;
			} else if (supportLevel === SupportLevels.Native) {
				captureAndWrapNativeAPI();
			} else if (supportLevel === SupportLevels.Browser) {
				captureAndWrapBrowserAPI();
			}

			openPromise = requestInitialQuota()
				.then(openFileSystem);

			openPromise
				.then(function (fs) {
					fileSystem = fs;
				}, close);

			return openPromise;
		}

		// ## requestInitialQuota()
		//
		// Issues an HTML File System initial quota request for the configured amount.
		// No quota request is made if the current quota exceeds the configured initial amount.
		//
		// If the Native API is being used, this method resolves immediately.
		//
		// Returns a promise that resolves if the quota was granted.
		//
		function requestInitialQuota() {
			// No-op for Native API
			if (supportLevel === SupportLevels.Native) {
				return AH.resolve();
			}

			// In the HTML API 'If you call requestQuota() again after the user has already granted permission, nothing happens. So don't bother calling the method again.'
			// This means that the success handler for 'requestQuota' won't be called, which leaves us with an unresolved promise.
			// So we need to make sure and only make the request if our current quota is smaller than the amount we are going to request.
			return queryUsageAndQuota()
				.then(function(info) {
					var currentQuota = info[USAGE_INFO_QUOTA_INDEX];
					if (currentQuota >= initialQuota) {
						return currentQuota;
					}

					return requestQuota(initialQuota);
				});
		}

		// ## requestQuotaIncrease()
		//
		// Issues a request to increase the HTML File System quota by the configured amount.
		//
		// This method should not be called if the Native API is being used.
		//
		// Returns a promise that resolves if the additional quota was granted.
		//
		function requestQuotaIncrease() {
			return queryUsageAndQuota()
				.then(function(info) {
					return requestQuota(info[USAGE_INFO_QUOTA_INDEX] + QUOTA_SIZE_INCREASE);
				});
		}

		// ## openFileSystem(grantedBytes)
		//
		// Requests a file system object.
		//
		//	* grantedBytes: The amount quota (in bytes) that is available.
		//
		// Returns a promise that resolves with the file system object.
		//
		function openFileSystem(grantedBytes) {
			return requestFileSystem(grantedBytes || 0);
		}

		// ## close()
		//
		// Closes the file system module. This is only used by unit tests.
		//
		function close() {
			openPromise = closedRejectedPromise;

			requestFileSystem = undefined;
			fileSystem = undefined;
			normalizeDataForWrite = undefined;

			requestQuota = undefined;
			queryUsageAndQuota = undefined;

			supportLevel = undefined;
		}

		// ## getFileEntry(path, options)
		//
		// Gets the file entry for the file at the specified path.
		//
		//	* path: The full absolute path from the root to the file..
		//	* options:
		//		create: (default: true) True if the file and all intermediate directories should be created.
		//
		// Returns a promise that resolves with the file entry.
		//
		var getFileEntry = _getFileEntry;
		function _getFileEntry(path, options) {
			options = options || { create: true };

			var pathInfo = parsePath(path);

			if (!pathInfo.filename) {
				return AH.reject(new Error("'path' refers to a directory and not to a file ('" + path + "')."));
			}

			return getDirectory(pathInfo.dir, { create: options.create })
				.then(function(directory) {
					return AH.whenCallViaCallbacks(directory.getFile, directory, pathInfo.filename, options);
				});
		}

		/**
		 * @method writeFile
		 *
		 * Writes the data to the specified path, overwriting any existing file data.
		 * The file and all intermediate directories are created if they don't already exist.
		 *
		 * ## Usage:
		 *
		 *     fs.writeFile("/Some/Directory/file.txt", "Hello World");
		 *     fs.writeFile("/Some/Directory/file.txt", fileOrBlob);
		 *
		 * @param {String} path
		 * The full absolute path from the root to the file.
		 *
		 * @param {String/Blob/File} data
		 * The data to be written.
		 *
		 * @returns {Promise}
		 * Resolves when the data has been written to the file.
		 *
		 */
		var writeFile = _writeFile;
		function _writeFile(path, data) {
			return open()
				.then(function() {
					return getFileEntry(path);
				})
				.then(function(fileEntry) {
					return writeDataToFileEntry(fileEntry, data);
				});
		}

		// ## writeDataToFileEntry(fileEntry, data)
		//
		// Writes the data to the given file entry, overwriting any existing file data.
		//
		//	* fileEntry: The file entry where the data will be written.
		//	* data: The data to be written.
		//		For the Native API, this value must be a string.
		//		For the HTML API, this value must be a blob.
		//
		// Returns a promise that resolves when the data has been written to the file entry.
		//
		function writeDataToFileEntry(fileEntry, data) {
			return normalizeDataForWrite(data)
				.then(function(normalizedData) {
					var dfd = AH.defer();

					fileEntry.createWriter(function(fileWriter) {
						var writePromise = writeNewDataToFile()
							.then(removeOldDataFromFile);

						AH.chainPromise(writePromise, dfd);

						// Writes the data using the writer
						function writeNewDataToFile() {
							var writeDfd = AH.defer();

							fileWriter.onerror = onError;
							fileWriter.onwriteend = onSuccess;

							fileWriter.write(normalizedData);

							return writeDfd.promise;

							function onSuccess() {
								writeDfd.resolve();
							}

							function onError(error) {
								writeDfd.reject(error);
							}
						}

						// Truncates any data after the current write position
						function removeOldDataFromFile() {
							if (supportLevel === SupportLevels.Native) {
								// The Native API automatically replaces the old file data
								return AH.resolve();
							}

							var truncateDfd = AH.defer();

							fileWriter.onerror = onError;
							fileWriter.onwriteend = onSuccess;

							fileWriter.truncate(fileWriter.position);

							return truncateDfd.promise;

							function onSuccess() {
								truncateDfd.resolve();
							}

							function onError(error) {
								truncateDfd.reject(error);
							}
						}
					}, function onError(error) {
						dfd.reject(error);
					});

					return dfd.promise;
				});
		}

		// ## normalizeDataForNativeWrite(data)
		//
		// Converts the given data to a format that can be written using the Native API.
		//
		// Data is converted to a base 64 encoded string.
		//
		//	* data: The data to be normalized.
		//
		// Returns a promise that resolves with the normalized data.
		//
		function normalizeDataForNativeWrite(data) {
			if (_.isString(data)) {
				return AH.resolve(window.btoa(data));
			} else if (data instanceof Blob || data instanceof File) {
				return readBlobAsBase64String(data);
			}

			return AH.reject(new Error("Unable to normalize data for write. 'data' is not of a supported type."));
		}

		// ## normalizeDataForHtmlWrite(data)
		//
		// Converts the given data to a format that can be written using the HTML API.
		//
		// Data is encoded as a base64 string and wrapped in a Blob.
		//
		//	* data: The data to be normalized.
		//
		// Returns a promise that resolves with the normalized data.
		//
		function normalizeDataForHtmlWrite(data) {
			return normalizeDataForNativeWrite(data)
				.then(function(nativeData) {
					// Html API doesn't support writing strings directly,
					// so we have to put the string into a blob
					return (AH.createBlob(nativeData, "text/plain"));
				});
		}

		// ## readBlobAsBase64String(blob)
		//
		// Reads blob data and encodes it as a base 64 string.
		//
		//	* blob: The blob data to be read and encoded.
		//
		// Returns a promise that resolves with the base 64 string.
		//
		function readBlobAsBase64String(blob) {
			var dfd = AH.defer();

			var fileReader = new FileReader();

			fileReader.onerror = onError;
			fileReader.onloadend = onSuccess;

			fileReader.readAsArrayBuffer(blob);

			return dfd.promise;

			function onSuccess(evt) {
				var arrayBuffer = evt.target.result;

				dfd.resolve(AH.arrayBufferToBase64String(arrayBuffer));
			}

			function onError(error) {
				dfd.reject(error);
			}
		}

		/**
		 * @method getFile
		 *
		 * Gets the file at the given path.
		 *
		 * ## Usage:
		 *
		 *     fs.getFile("/Some/Directory/file.txt");
		 *
		 * @param {String} path
		 * The full absolute path from the root to the file.
		 *
		 * @returns {Promise}
		 * Resolves with a Blob with the data of the file at the specified path.
		 *
		 * Rejects if the specified file does not exist.
		 *
		 */
		function getFile(path) {
			return open()
				.then(function() {
					return getFileEntry(path, { create: false });
				})
				.then(readFileFromFileEntry);

			function readFileFromFileEntry(fileEntry) {
				var dfd = AH.defer();

				fileEntry.file(convertBase64EncodedFileToBlob, onError);

				return dfd.promise;

				function convertBase64EncodedFileToBlob(file) {
					var fileReader = new FileReader();

					fileReader.onerror = onError;
					fileReader.onload = function(evt) {
						// All data written using our API is encoded as a base 64 string
						// so the data must be decoded.
						var base64String = evt.target.result;

						var arrayBuffer = AH.base64StringToArrayBuffer(base64String);

						dfd.resolve(AH.createBlob(arrayBuffer,
							// The Native API doesn't provide an easy way to lookup a file's
							// mime type so we have to set it using the file's extension
							getMimeType(path)
						));
					};

					fileReader.readAsText(file);
				}

				function onError(error) {
					dfd.reject(error);
				}
			}
		}

		// ## getDirectory(path, options)
		//
		// Gets the directory at the specified path.
		//
		//	* path: The full absolute path from the root to the directory.
		//	* options:
		//		create: (default: true) True if the directory should be created.
		//
		// Returns a promise that resolves with the directory entry.
		//
		function getDirectory(path, options) {
			options = options || { create: true };

			var dfd = AH.defer();

			var folders = _.without(path.split("/"), "");

			createNextSubDirectory(fileSystem.root);

			return dfd.promise;

			function createNextSubDirectory(parentDirectory) {
				if (!folders.length) {
					dfd.resolve(parentDirectory);
				} else {
					var folder = folders.shift();
					parentDirectory.getDirectory(folder, options, function(subDirectory) {
						createNextSubDirectory(subDirectory);
					}, function(error) {
						dfd.reject(error);
					});
				}
			}
		}

		// ## parsePath(path)
		//
		// Parses the specified path.
		//
		//	* The path to a directory or a file.
		//
		// Returns an object with the following properties:
		//
		//	* dir: The directory component of the path.
		//	* filename: The filename component of the path.
		//	* path: The full path.
		//
		function parsePath(path) {
			if (!AH.isDefined(path) || !_.isString(path)) {
				throw new Error("'path' must be a valid string.");
			}

			if (path === "") {
				return {
					dir: "",
					filename: "",
					path: ""
				};
			}

			var filenameOffset = path.lastIndexOf("/") + 1;
			var filename = path.substr(filenameOffset);
			var dir = path.substr(0, filenameOffset);

			return {
				dir: dir,
				filename: filename,
				path: dir + filename
			};
		}

		// ## getFileExtension(path)
		//
		// Gets the extension of the file at the given path.
		//
		//	* path: The filename or path of the file.
		//
		// Returns the extension of the file (excluding the '.').
		//
		function getFileExtension(path) {
			var pathInfo = parsePath(path);
			var filename = pathInfo.filename;

			var extensionOffset = filename.lastIndexOf(".");
			if (extensionOffset === -1) {
				return "";
			}

			return filename.substr(extensionOffset + 1);
		}

		/**
		 * @method getMimeType
		 *
		 * Gets the mime type (based on the file's extension) of the file at the given path.
		 *
		 * ## Usage:
		 *
		 *     fs.getMimeType("file.txt");
		 *
		 *     fs.getMimeType("/Some/Directory/file.txt");
		 *
		 * @param {String} path
		 * The filename or path of the file.
		 *
		 *
		 * @returns {Promise}
		 * The mime type of the file based on its extension.
		 *
		 */
		function getMimeType(path) {
			var extension = getFileExtension(path);

			return mimeTypes[extension.toLowerCase()] || defaultMimeType;
		}

		/**
		 * @method copyFile
		 *
		 * Copies the file from a given source path to a destination path.
		 *
		 * ## Usage:
		 *
		 *     fs.copyFile("/Some/Directory/file.txt", "/Some/Other/Directory/file.txt");
		 *
		 * @param {String} srcPath
		 * The full absolute path from the root to the source file.
		 *
		 * @param {String} dstPath
		 * The full absolute path from the root to the destination file.
		 *
		 * @returns {Promise}
		 * Resolves when the file has been copied to the destination path.
		 *
		 */
		var copyFile = _copyFile;
		function _copyFile(srcPath, dstPath) {
			return open()
				.then(function() {
					return getFileEntry(srcPath, { create: false });
				})
				.then(function(srcFileEntry) {
					var dstPathInfo = parsePath(dstPath);

					// The Cordova plugin doesn't strictly adhere to the W3C 'copyTo' spec.
					// It doesn't attempt to delete existing files before performing the copy.
					// Instead it returns a FileError.INVALID_MODIFICATION_ERR
					//
					// So we need to explicitly try to delete the existing file.
					return deleteFile(dstPath)
						.then(function() {
							return getDirectory(dstPathInfo.dir);
						})
						.then(function(dstDirectory) {
							return AH.whenCallViaCallbacks(srcFileEntry.copyTo, srcFileEntry, dstDirectory, dstPathInfo.filename);
						});
				});
		}

		/**
		 * @method deleteFile
		 *
		 * Deletes the file at the given path.
		 *
		 * ## Usage:
		 *
		 *     fs.deleteFile("/Some/Directory/file.txt");
		 *
		 * @param {String} path
		 * The full absolute path from the root to the file.
		 *
		 * @returns {Promise}
		 * Resolves when the file has been deleted.
		 *
		 */
		function deleteFile(path) {
			return open()
				.then(function() {
					return getFileEntry(path, { create: false });
				})
				.then(function(fileEntry) {
					return AH.whenCallViaCallbacks(fileEntry.remove, fileEntry);
				})
				.then(null, ignoreNotFoundError);
		}

		/**
		 * @method deleteDirectory
		 *
		 * Deletes the directory at the given path.
		 *
		 * ## Usage:
		 *
		 *     fs.deleteDirectory("/Some/Directory/");
		 *
		 * @param {String} path
		 * The full absolute path from the root to the directory.
		 *
		 * @returns {Promise}
		 * Resolves when the directory has been deleted.
		 *
		 */
		function deleteDirectory(path) {
			return open()
				.then(function() {
					var pathInfo = parsePath(path);

					if (pathInfo.filename) {
						return AH.reject(new Error("'path' refers to a file and not to a directory ('" + path + "')."));
					}

					return getDirectory(pathInfo.dir, { create: false });
				})
				.then(function(directoryEntry) {
					return AH.whenCallViaCallbacks(directoryEntry.removeRecursively, directoryEntry);
				})
				.then(null, ignoreNotFoundError);
		}

		function ignoreNotFoundError(error) {
			if (error.code !== FileError.NOT_FOUND_ERR) {
				return AH.reject(error);
			}
		}

		// ## wrapActionWithRetry(action)
		//
		// Wraps an action with the behavior of automatically requesting a quota increase
		// and re-executing the action when the action fails with a quota exceeded error.
		//
		// This behavior only applies when the HTML API is being used. When the Native API
		// is being used, then the action behaves as normal.
		//
		//	* action: The function action to be wrapped.
		//
		// Returns the promise returned by the wrapped action.
		//
		function wrapActionWithRetry(action) {
			return function() {
				// Capture execution info
				var self = this;
				var args = arguments;

				// Try executing the action
				var promise = executeAction();

				if (supportLevel === SupportLevels.Browser) {
					// If we are using the browser's file system
					// and we get a QUOTA_EXCEEDED_ERR,
					// then try requesting a quota increase and re-execute the action.
					promise = promise.then(null, function(error) {
						if (error.code === FileError.QUOTA_EXCEEDED_ERR) {
							return requestQuotaIncrease()
								.then(executeAction, function() {
									return AH.reject(error);
								});
						}

						return AH.reject(error);
					});
				}

				return promise;

				function executeAction() {
					return action.apply(self, args);
				}
			};
		}

		var exports = {
			// We can't pass functions directly into the 'wrapActionWithRetry',
			// because we want to be able to spy on the functions during unit tests
			writeFile: wrapActionWithRetry(function() {
				return writeFile.apply(this, arguments);
			}),
			getFile: wrapActionWithRetry(function() {
				return getFile.apply(this, arguments);
			}),
			deleteFile: wrapActionWithRetry(function() {
				return deleteFile.apply(this, arguments);
			}),
			copyFile: wrapActionWithRetry(function() {
				return copyFile.apply(this, arguments);
			}),
			deleteDirectory: deleteDirectory,
			parsePath: parsePath,
			getMimeType: getMimeType,

			SupportLevels: SupportLevels,

			// Expose error codes so that we can still execute
			// unit tests that don't directly access the file system
			// but rely on file related error code.
			//
			// For example, unit testing the Vault class shouldn't directly
			// rely on file system support. This means we can run the unit tests
			// in PhantomJs, which doesn't currently support the File System API
			FileError: {
				NOT_FOUND_ERR: window.FileError ? window.FileError.NOT_FOUND_ERR : 1,
				QUOTA_EXCEEDED_ERR: window.FileError ? window.FileError.QUOTA_EXCEEDED_ERR : 10
			},

			_close: close,
			_initialQuota: initialQuota,
			_quotaSizeIncrease: QUOTA_SIZE_INCREASE,
			_getDirectory: getDirectory,
			_createFileError: function(errorCode) {
				var level = getSupportLevel();
				var error;

				if (level === SupportLevels.Native) {
					error = new FileError(errorCode);
				} else {
					// We can't directly create a FileError instance
					// because it throws an 'illegal constructor' error in Chrome
					// and PhantonJS doesn't support it at all
					error = new Error();
					error.code = errorCode;

					if (FileError) {
						/* eslint-disable no-proto */
						error.__proto__ = FileError.prototype;
						/* eslint-enable no-proto */
					}
				}

				return error;
			}
		};

		Object.defineProperties(exports, {
			isSupported: {
				get: function() {
					return this.supportLevel !== SupportLevels.None;
				}
			},
			supportLevel: {
				get: getSupportLevel
			},
			_fs: {
				get: function () {
					return fileSystem;
				}
			},
			_getFileEntry: {
				get: function() {
					return getFileEntry;
				},
				set: function(value) {
					getFileEntry = value;
				}
			},
			_writeFile: {
				get: function() {
					return writeFile;
				},
				set: function(value) {
					writeFile = value;
				}
			},
			_copyFile: {
				get: function() {
					return copyFile;
				},
				set: function(value) {
					copyFile = value;
				}
			},
			_open: {
				get: function() {
					return open;
				},
				set: function(value) {
					open = value;
				}
			},
			_requestQuota: {
				get: function() {
					return requestQuota;
				},
				set: function(value) {
					requestQuota = value;
				}
			},
			_queryUsageAndQuota: {
				get: function() {
					return queryUsageAndQuota;
				},
				set: function(value) {
					queryUsageAndQuota = value;
				}
			},
			_captureAndWrapBrowserAPI: {
				get: function() {
					return captureAndWrapBrowserAPI;
				},
				set: function(value) {
					captureAndWrapBrowserAPI = value;
				}
			}
		});

		return exports;
	}());
});
define('Files/Operation',[
	"AH",
	"underscore",
	"lib/Class"
], function (
	AH,
	_,
	Class
	) {

	"use strict";

	// # Operation module
	//
	// Represents a file system operation to be executed at a later time.
	//
	return Class.extend({
		// ## execute()
		//
		// Executes the file system operation. An operation can only be executed once, subsequent calls to execute return the same promise.
		//
		execute: function() {
			if (!this._executionPromise) {
				this._executionPromise = this._onExecute();
			}

			return this._executionPromise;
		},

		_onExecute: function() {}
	});
});
define('Files/WriteOperation',[
	"./fileSystem",
	"./Operation"
], function (
	fs,
	Operation
	) {

	"use strict";

	// # WriteOperation module
	//
	// Represents a file system 'write' operation to be executed at a later time.
	//
	return Operation.extend({
		initialize: function(path, data) {
			Operation.prototype.initialize.apply(this, arguments);

			this._path = path;
			this._data = data;
		},

		_onExecute: function() {
			return fs.writeFile(this._path, this._data);
		}
	});
});
define('Files/CopyOperation',[
	"./fileSystem",
	"./Operation"
], function (
	fs,
	Operation
	) {

	"use strict";

	// # CopyOperation module
	//
	// Represents a file system 'copy' operation to be executed at a later time.
	//
	return Operation.extend({
		initialize: function(srcPath, dstPath) {
			Operation.prototype.initialize.apply(this, arguments);

			this._srcPath = srcPath;
			this._dstPath = dstPath;
		},

		_onExecute: function() {
			return fs.copyFile(this._srcPath, this._dstPath);
		}
	});
});
define('Files/DeleteOperation',[
	"./fileSystem",
	"./Operation",
	"Logging/logger",
	"AH"
], function (
	fs,
	Operation,
	logger,
	AH
	) {

	"use strict";

	// # CopyOperation module
	//
	// Represents a file system 'delete' operation to be executed at a later time.
	// If alwaysSucceed is true, execute will resolve and log any errors.
	//
	return Operation.extend({
		initialize: function(path, alwaysSucceed) {
			Operation.prototype.initialize.apply(this, arguments);

			this._path = path;
			this._alwaysSucceed = alwaysSucceed;
		},

		_onExecute: function() {
			var promise = fs.deleteFile(this._path);
			if (this._alwaysSucceed) {
				promise = promise.then(null, function (error) {
					logger.logError(error);
					return AH.resolve();
				});
			}
			return promise;
		}
	});
});
define('MDO/Vault',[
	"AH",
	"underscore",
	"Files/fileSystem",
	"Files/WriteOperation",
	"Files/CopyOperation",
	"Files/DeleteOperation"
], function (
	AH,
	_,
	fs,
	WriteOperation,
	CopyOperation,
	DeleteOperation
	) {

	"use strict";

	/**
	 * @class MDO.Vault
	 * @private
	 * Represents a file Vault used by a datastore to manage (add/remove) file attachments.
	 *
	 * The vault stores file attachments in model class specific directories
	 * to avoid filename conflicts across model classes. For example, file attachments
	 * for the 'AH_AttachedFile' class are stored
	 * in the '/Datastores/&lt;datastore id&gt;/Vault/AH_AttachedFile/' directory.
	 *
	 * This also means that filenames of attachments for a particular model class must be unique.
	 */
	return function (dsInfo) {
		var operationQueue;

		var transactionNotStartedError = new Error("A transaction has not been started.");
		var transactionInProgressError = new Error("A transaction is already in progress.");

		resetTransactionInfo();

		// ## destroy()
		//
		// Deletes the datastore specific '/Datastores/<datastore id>/Vault/' directory and all of it's contents
		//
		// Returns a promise that resolves when the directory is deleted.
		//
		function destroy() {
			if (fs.isSupported) {
				return fs.deleteDirectory(getVaultDirectory());
			}

			return AH.resolve();
		}

		// ## beginTransaction()
		//
		// Initiates a 'transaction' for vault related operations (e.g. adding/removing a vault file).
		// This is required for vault operations that may occur during an mdoTransaction.
		//
		function beginTransaction() {
			if (operationQueue) {
				throw transactionInProgressError;
			}

			operationQueue = [];
		}

		// ## commitTransaction()
		//
		// Commits the active 'transaction' that was initiated by a call to `beginTransaction`.
		// All vault operations that occurred within the current transaction will be commited.
		//
		function commitTransaction() {
			if (!operationQueue) {
				return AH.reject(transactionNotStartedError);
			}

			// capture queue before re-setting it
			var queue = operationQueue;

			resetTransactionInfo();

			return _.reduce(queue, function(promise, operation) {
				return promise.then(function() {
					return operation.execute();
				});
			}, AH.resolve());
		}

		// ## commitTransaction()
		//
		// Rollsback the active 'transaction' that was initiated by a call to `beginTransaction`.
		// All vault operations that occurred within the current transaction will not be committed.
		//
		function rollbackTransaction() {
			if (!operationQueue) {
				return AH.reject(transactionNotStartedError);
			}

			resetTransactionInfo();

			return AH.resolve();
		}

		// ## resetTransactionInfo()
		//
		// Clears all information associated with the current transaction
		//
		function resetTransactionInfo() {
			operationQueue = undefined;
		}

		// ## executeOrQueueOperation(operation)
		//
		// Immediately executes the given operation if no transaction is active,
		// or queues the operation for execution if a transaction is active.
		//
		//	* operation: The operation to be queued or executed.
		//
		// No Active Transaction: Returns a promise that resolves when the operation has finished executing.
		// Active Transaction: A promise that resolves when the operation has been queued for execution.
		//
		var executeOrQueueOperation = _executeOrQueueOperation;
		function _executeOrQueueOperation(operation) {
			if (!operationQueue) {
				return operation.execute();
			}

			operationQueue.push(operation);
			return AH.resolve();
		}

		// ## addFile(data, modelClass, filename)
		//
		// Adds the given file attachment to the vault.
		//
		//	* data:
		//		The full absolute path from the root to a file.
		//		A File object.
		//		A Blob object.
		//
		//	* modelClass: The model class name, or model class instance that the file attachment belongs to.
		//
		//	* filename: The name of the attachment as it will be written in the vault.
		//
		// No Active Transaction: Returns a promise that resolves when the file has been added to the vault.
		// Active Transaction: A promise that resolves when the 'add' operation has been queued for execution.
		//
		function addFile(data, modelClass, filename) {
			var vaultFilePath = getVaultFilePath(modelClass, filename);
			var operation;

			if (_.isString(data)) {
				operation = new CopyOperation(data, vaultFilePath);
			} else if (data instanceof Blob || data instanceof File) {
				operation = new WriteOperation(vaultFilePath, data);
			} else {
				return AH.reject(new Error("Unable to add vault file. File 'data' is not of a supported type."));
			}

			return executeOrQueueOperation(operation);
		}

		// ## removeFile(modelClass, filename)
		//
		// Removes the given file attachment to the vault.
		//
		//	* modelClass: The model class name, or model class instance of the file attachment to be deleted.
		//
		//	* filename: The name of the attachment in the vault to be deleted.
		//
		//	* alwaysSucceed: if true, any errors will be resolved and logged.
		//
		// No Active Transaction: Returns a promise that resolves when the file has been removed from the vault.
		// Active Transaction: A promise that resolves when the 'remove' operation has been queued for execution.
		//
		function removeFile(modelClass, filename, alwaysSucceed) {
			var deleteOperation = new DeleteOperation(getVaultFilePath(modelClass, filename), alwaysSucceed);

			return executeOrQueueOperation(deleteOperation);
		}

		// ## getFile(modelClass, filename)
		//
		// Gets file attachment from the vault.
		//
		//	* modelClass: The model class name, or model class instance of the file attachment.
		//
		//	* filename: The name of the attachment in the vault.
		//
		// Returns a promise that resolves with the file attachment, or null if the attachment does not exist.
		//
		function getFile(modelClass, filename) {
			var vaultFilePath = getVaultFilePath(modelClass, filename);

			return fs.getFile(vaultFilePath)
				.then(null, function(error) {
					if (error.code !== fs.FileError.NOT_FOUND_ERR) {
						return AH.reject(error);
					}
					return AH.resolve(null);
				});
		}

		// ## getVaultFilePath(modelClass, filename)
		//
		// Gets the full absolute path to a vault file (i.e. /Datastores/<datastore id>/Vault/<class name>/<filename>).
		//
		function getVaultFilePath(modelClass, filename) {
			var className = _.isString(modelClass) ? modelClass : modelClass.name;

			// We need to make sure to encode the filename so that we can properly
			// deal with backslash (\) directory separators coming from the M-Tier server
			return getVaultDirectory() + className + "/" + encodeURIComponent(filename);
		}

		// ## getVaultDirectory()
		//
		// Gets the full absolute path to the vault directory (i.e. /Datastores/<datastore id>/Vault/).
		//
		function getVaultDirectory() {
			return dsInfo.directory() + "Vault/";
		}

		var exports = {
			addFile: addFile,
			getFile: getFile,
			removeFile: removeFile,

			getVaultFilePath: getVaultFilePath,
			getVaultDirectory: getVaultDirectory,

			beginTransaction: beginTransaction,
			commitTransaction: commitTransaction,
			rollbackTransaction: rollbackTransaction,

			destroy: destroy
		};

		Object.defineProperties(exports, {
			_executeOrQueueOperation: {
				get: function() {
					return executeOrQueueOperation;
				},
				set: function(value) {
					executeOrQueueOperation = value;
				}
			},
			_operationQueue: {
				get: function() {
					return operationQueue;
				}
			}
		});

		return exports;
	};
});

define('Data/AbstractStore',[
	"lib/Class",
	"AH",
	"underscore",
	"DataModel/ModelField",
	"Data/TempId/TempIdCache",
	"DataModel/Model",
	"Settings/Datastore",
	"MDO/Vault",
	"Logging/logger",
	"Files/fs",
	"Constants"
], function (
	Class,
	AH,
	_,
	ModelField,
	TempIdCache,
	Model,
	DatastoreSettings,
	Vault,
	logger,
	fs,
	Constants
	) {

	"use strict";

	// these values must match the server! (DataSyncJsonConverter.cs)
	var MtlBlobIdentifier = "\u0000\u0000\u0000";
	var MtlDateIdentifier = "\u0000\u0000\u0001";

	/**
	 * @class Data.AbstractStore
	 * Exposes access to data in the form of rows.
     *
     * @abstract
	 * @private
	 */
	var AbstractStore = Class.extend({
		/**
		 * @constructor
		 * @protected
		 * Creates a new AbstractStore instance
		 *
		 * @param {LocalStorage.DataStore} dsInfo
		 * Information for the DataStore such as Id, Name, and Series and Sequence numbers.
		 */
		constructor: function(dsInfo) {
			this._dsInfo = dsInfo;
			this._dsSettings = undefined;
			this._db = undefined;
			this._model = undefined;
			this._vault = new Vault(this._dsInfo);
			this._tempIdCache = undefined;
		},
		/**
		 * @method close
		 * Closes the database
		 *
		 * @return {Promise.<Data.Store>}
		 * Promise that resolves with the Store
		 */
		close: function () {
			// Note: we don't actively close the database
			this._dsSettings = undefined;
			this._db = undefined;
			this._tempIdCache = undefined;
			this._model = undefined;
			return AH.resolve(this);
		},
		/**
		 * @method getModelClass
		 * Retrieves the model class for the given className
		 *
		 * @param {string} className
		 *
		 * @return {DataModel.Class}
		 * {@link DataModel.Class ModelClass} matching the `className` or throws an error
		 */
		getModelClass: function (className) {
			if (!this._model) {
				throw new Error("No model specified");
			}

			var cl = this._model.classes.getByName(className);
			if (!cl) {
				throw new Error("Invalid class name: " + className);
			}
			return cl;
		},
		_loadModel: function () {
			var self = this;
			var promiseImportModel;
			var needToImportModel = !self._dsSettings.model() && self._dsSettings.modelVersion();
			if (needToImportModel) {
				promiseImportModel = importModel();
			}

			return AH.when(promiseImportModel)
				.then(function () {
					var modelString = self._dsSettings.model();
					if (modelString) {
						self._model = Model.fromString(self._dsSettings.model());
					} else {
						self._model = undefined;
					}
				});

			function importModel() {
				var promise = fs.readFile(self._dsInfo.modelPath())
					.then(function (file) {
						return self._dsSettings.model(file.content);
					});

				promise
					.then(function () {
						return fs.deleteFile(self._dsInfo.modelPath());
					});

				return promise;
			}
		},
		_loadSettings: function () {
			var self = this;
			self._dsSettings = new DatastoreSettings(self._db);

			return self._dsSettings.load()
				.then(function () {
					// if db based settings are empty, then we need to migrate local storage
					// based settings to db
					if (self._dsSettings.isEmpty()) {
						return self._transaction(function () {
							return self._dsSettings.importSettingsFromDsInfo(self._dsInfo);
						});
					}
				});
		},
		/**
		 * @method _setModel
		 * @private
		 *
		 * Sets the model property to `newModel`
		 */
		_setModel: function (newModel) {
			this._model = newModel;
		},
		/**
		 * @method _retrieveTempIdCache
		 * @private
		 * If the db has been defined, get the tempIdCache.
		 *
		 * @return {Promise}
		 * Resolves with the tempIdCache
		 */
		_retrieveTempIdCache: function () {
			var self = this;
			return AH.when(AH.deferredTryCatch(function () {
				if (!self._db) {
					throw new Error("Database has not been opened. Cannot access TempIdCache");
				}
				if (self._tempIdCache) {
					return self._tempIdCache;
				}
				self._tempIdCache = new TempIdCache(undefined, { database: self._db });
				return self._tempIdCache.fetch();
			}), undefined, function () {
				self._tempIdCache = undefined;
			});
		},
		/**
		 * @method _reloadTempIdCache
		 * @private
		 * Reloads temp id cache values from the database, discarding any non-committed values
		 *
		 * @return
		 * Promise that resolves with the reloaded tempIdCache
		 */
		_reloadTempIdCache: function () {
			this._tempIdCache = undefined;

			return this._retrieveTempIdCache();
		},
		/**
		 * @method _openDatabase
		 * @private
		 * Returns a promise for the database underneath this Store. If the database has already been opened, then it will
		 * return the existing connection; otherwise, it will create a new connection and open it.
		 */
		_openDatabase: function () {
			return (this._db || (this._db = AH.websql(this._dsInfo.dbName()))).promise;
		},
		/**
		 * @method _transaction
		 * @private
		 * Executes and wraps all database and vault operations within that callback in a single transaction.
		 * The callback must return a promise that resolves when all database operations have completed.
		 *
		 * @param {function(): Promise} callback
		 * Function that performs database and vault operations operations
		 *
		 * @return {Promise}
		 * Promise that resolves when the Transaction is complete
		 *
		 * ## Usage:
		 *      store.transaction(function() {
		 *			var promises = [];
		 *			_.each(mdoElts, function(mdoElt) {
		 *				promises.push(mdoElt.destroy());
		 *          })
		 *
		 *			return AH.whenAll(promises);
		 *      });
		 *
		 */
		_transaction: function (callback) {
			var self = this;
			if (!_.isFunction(callback)) {
				return AH.reject(new Error("No transaction callback was specified"));
			}

			var vaultXactStarted = false;

			return self._db.promise
				.then(executeXact)
				.then(commitVaultTransaction, rollbackVaultTransaction);

			function executeXact() {
				var dfd = AH.defer();
				self._vault.beginTransaction();
				vaultXactStarted = true;

				var dbXactPromise = self._db.transactionBatch(function () {
					try {
						var callbackPromise = callback();

						AH.when(callbackPromise, null, null, function (msg) {
							dfd.progress(msg);
						});

						return callbackPromise;
					} catch (error) {
						return AH.reject(error);
					}
				});

				dbXactPromise = dbXactPromise.then(null, function (error) {
					// The datastore settings may have been updated as part of the failed transaction.
					// So they need to be re-loaded to ensure that the in-memory cache isn't stale,
					return self._dsSettings.load()
						.then(_.bind(self._loadModel, self))
						.then(_.bind(self._reloadTempIdCache, self))
						.always(function () {
							return AH.reject(error);
						});
				});

				AH.when(dbXactPromise, function (value) {
					dfd.resolve(value);
				}, function (error) {
					dfd.reject(error);
				});

				return dfd.promise;
			}

			function commitVaultTransaction(value) {
				return self._vault.commitTransaction()
					.then(function () {
						return value;
					}, function(vaultError) {
						var error = new Error("There was an error committing file updates. File elements may be in an inconsistent state.");
						error.exception = vaultError;

						self._logError(error);

						return AH.reject(error);
					});
			}

			function rollbackVaultTransaction(error) {
				if (vaultXactStarted) {
					return self._vault.rollbackTransaction()
						.then(rejectWithOriginalError, rejectWithOriginalError);
				}
				return rejectWithOriginalError();

				function rejectWithOriginalError() {
					return AH.reject(error);
				}
			}
		},
		/**
		 * @method _logError
		 * @private
		 * Uses the logger to log an error with the datastore's Id
		 *
		 * @param {Error} error
		 * Error to write to the logs
		 *
		 * @param {Object.<string,string|number|boolean>} options
		 * Options for the logger
		 *
		 * @param {string} options.domainId
		 * GUID representing the domain
		 *
		 * @param {string} options.appId
		 * GUID representing the application
		 *
		 * @param {string} options.category
		 * Category of the logged item
		 *
		 * @return {Promise}
		 * Resolves when log operation completes
		 */
		_logError: function (error, options) {
			logger.logError(error, _.extend({
				domainId: this._dsInfo.id()
			}, options));
		},
		/**
		 * @method getRows
		 * @async
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the rows
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @param {boolean} [config.totalCount=false]
		 * Set the `totalCount` property of returned `rows`.
		 *
		 * @param {Object} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string} [config.queryOptions.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		getRows: function (config) {
			return this._readRows(config);
		},
		/**
		 * @method getRow
		 * @async
		 *
		 * Retrieves a single row from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the row
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @param {Object} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string} [config.queryOptions.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Row>}
		 * Resolves with the retrieved row. Rejects if more than one, or no rows exist
		 */
		getRow: function (config) {

			return this._readRows(config)
				.then(extractSingleRow);

			function extractSingleRow(results) {
				if (results.length === 1) {
					return results[0];
				}

				var error = new Error(results.length + " rows matched for '" + config.className + "' WHERE " + JSON.stringify(config.filter));
				error.mdoCode = results.length < 1
					? Constants.errorCodes.dataNotFound
					: Constants.errorCodes.dataNotUnique;
				return AH.reject(error);
			}
		},

		/**
		 * @method _readRows
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @abstract
		 * @async
		 * @private
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the row
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @param {boolean} [config.totalCount=false]
		 * Set the `totalCount` property of returned `rows`.
		 *
		 * @param {Object} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string} [config.queryOptions.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		_readRows: function (config) {
			var error = new Error("abstract method, _readRows, has not been implemented");
			error.mdoCode = Constants.errorCodes.notSupported;
			return AH.reject(error);
		}
	}, {
		/**
		 * @method dbToMtlValue
		 * @static
		 * @private
		 * Prepends serialization identifiers for field types that are serialized
		 * differently in MTL files
		 *
		 * @param {Object} field
		 * Field descriptor
		 *
		 * @param {string} field.fieldType
		 * Type of the field to convert a value for
		 *
		 * @param {Object|string|number} value
		 * Field value to convert from db value to MTL value.
		 */
		dbToMtlValue: function (field, value) {
			if (_.isNull(value)) {
				return value;
			}
			switch (field.fieldType) {
				case "Bool":
					return AH.boolFromDb(value);
				case "Blob":
					return MtlBlobIdentifier + value;
				case "Timestamp":
					return MtlDateIdentifier + value;
				default:
					return value;
			}
		},
		/**
		 * @method mtlToDbValue
		 * @static
		 * @private
		 * Removes leading identifiers for field types that are serialized
		 * differently in MTL files
		 *
		 * @param {Object} field
		 * Field descriptor
		 *
		 * @param {string} field.fieldType
		 * Type of the field to convert a value for
		 *
		 * @param {Object|string|number} value
		 * Field value to convert from MTL value to db value.
		 */
		mtlToDbValue: function (field, value) {
			if (_.isNull(value)) {
				return value;
			}
			switch (field.fieldType) {
				case "Bool":
					// Value may be false/true (SQLServer) or 0/1 (Oracle)
					return value ? 1 : 0;
				case "Blob":
					return value.substring(MtlBlobIdentifier.length);
				case "Timestamp":
					return value.substring(MtlDateIdentifier.length);
				default:
					return value;
			}
		},
		/**
		 * @method parseFilter
		 * @private
		 * Converts an object / MdoElement 'filter' into a logical filter string for the 'modelClass'.
		 * When an object filter is specified, the values are converted into a filterParams array, and
		 * any serialization identifiers (for dates, blobs, etc.) are stripped.
		 *
		 * @param {Object|string} filter
		 * object/MdoElement filter or logical string filter
		 *
		 * @param {Array.<string|number>} filterParams
		 * filter values
		 *
		 * @param {DataModel.Class} modelClass
		 * Table to filter against
		 *
		 * @param {boolean} [toServerValues=false]
		 * if true, method will convert filterParameters to Server values
		 *
		 * @return {Object.<string,string|Array>}
		 * A filter
		 *
		 * @return {string} return.filter
		 * Logical filter string
		 *
		 * @return {Array.<string|number>} return.filterParams
		 * filter values with identifiers stripped
		 */
		parseFilter: function(filter, filterParams, modelClass, toServerValues) {
			var parsedFilter = filter;

			if (!_.isString(filter)) {
				// Default to empty filter
				filter = filter || {};

				// Create filter
				var clauses = [];
				filterParams = [];
				_.keys(filter).forEach(function (key) {
					var field = modelClass.allFields.getByName(key, true);
					filterParams.push(field.valueToDb(filter[key]));
					if (ModelField.isIdField(field)) {
						key = modelClass.name + "." + key;
					}
					clauses.push(key + "=?");
				});

				// We can pass in the already physical 'clauses.join(" AND ")' into buildSelectQuery since
				// we shouldn't be encountering merged fields in this execution branch. (That is, when the
				// filter is an object and not a string).  No merged fields mean no joins, and thus no
				// complications with the join manager for parsing & creating the Order By expression.
				parsedFilter = clauses.join(" AND ");
			} else if (filterParams) {
				filterParams = _.map(filterParams, function (param) {

					if (_.isBoolean(param)) {
						return !toServerValues ? AH.boolToDb(param) : param;
					} else if (param instanceof Date) {
						return !toServerValues ? AH.dateToDb(param) : MtlDateIdentifier + AH.dateToDb(param);
					} else if (param instanceof Array) {
						return AH.blobToDb(param);
					}

					return param;
				});
			}

			return {
				filter: parsedFilter,
				filterParams: filterParams
			};
		}
	});

	Object.defineProperties(AbstractStore.prototype, {
		/**
		 * @property database
		 * WebSql Database for the store
		 */
		database: {
			get: function () { return this._db; }
		},
		/**
		 * @property {Settings.DataStore} settings
		 * Store Settings.
		 */
		settings: {
			get: function () { return this._dsSettings; }
		},
		/**
		 * @property {DataModel.Model} model
		 * model used by the store
		 */
		model: {
			get: function () { return this._model; }
		},
		/**
		 * @property {MDO.Vault} vault
		 * Vault used by the store
		 */
		vault: {
			get: function () { return this._vault; }
		},
		/**
		 * @property {LocalStorage.DataStore} dataStoreInfo
		 * Store Info.
		 */
		dataStoreInfo: {
			get: function () { return this._dsInfo; }
		}
	});

	return AbstractStore;

});
define('Data/XactPromiseWrapper',[
	"AH"
], function(
	AH
	) {

	"use strict";

	return function(xact) {
		var statementCount = 0;
		var dfd = AH.defer();
		var isDone = false;

		this.executeSql = function(sql, args, successCallback, errorCallback) {
			if (isDone) {
				throw new Error("Cannot add statements after the xact promise wrapped has been marked completed.");
			}

			statementCount++;

			xact.executeSql(sql, args, function() {
				if (successCallback) {
					successCallback.apply(this, arguments);
				}

				statementCount--;

				if (statementCount === 0) {
					dfd.resolve();

					isDone = true;
				}
			}, function(failedXact, error) {
				if (errorCallback) {
					errorCallback.apply(this, arguments);
				}

				statementCount--;

				if (statementCount === 0) {
					dfd.reject(error);

					isDone = true;
				}
			});
		};

		this.done = function() {
			isDone = true;

			if (statementCount === 0) {
				dfd.resolve();
			}
		};

		this._dfd = dfd;
		this.promise = dfd.promise;
	};
});
define('Data/FilterTokenizer',[], function() {
	"use strict";

	var logicalTokenPrefix = "$";
	
	// ### tokenize(filter)
	//
	// Tokenizes a filter into logical and non logical parts.
	//
	// Example:
	// 	filter: $ahWorkOrderRef.ahWorkOrder LIKE '%1234' and $ahWorkOrderRef.ahAssetRef = 5
	// 	returns: ["$ahWorkOrderRef.ahWorkOrder", " LIKE '%1234' and ", "$ahWorkOrderRef.ahAssetRef", " = 5"]
	//
	function tokenize(filter) {
		if (!filter) {
			return [];
		}

		var tokens = [];

		var startOfToken = 0;
		while (startOfToken < filter.length) {
			var endOfToken;

			// Determine which type of token to read
			if (filter[startOfToken] === logicalTokenPrefix) {
				endOfToken = findEndOfLogicalToken(startOfToken);
			} else {
				endOfToken = findEndOfNonLogicalToken(startOfToken);
			}

			// Add the token to the list
			tokens.push(filter.substring(startOfToken, endOfToken));

			// Advance (to the start of next token)/(to the end of the filter)
			startOfToken = endOfToken;
		}

		return tokens;

		function findEndOfLogicalToken(fromCharIndex) {
			var currentCharIndex;
			var currentChar;

			// Skip initial $
			for (currentCharIndex = fromCharIndex + 1; currentCharIndex < filter.length; currentCharIndex++) {
				currentChar = filter[currentCharIndex];

				if (!(currentChar === "." || currentChar === "_"
							|| (currentChar >= "a" && currentChar <= "z")
							|| (currentChar >= "A" && currentChar <= "Z")
							|| (currentChar >= "0" && currentChar <= "9"))) {

					// We've reached the end of a logical token
					break;
				}
			}

			return currentCharIndex;
		}

		function findEndOfNonLogicalToken(fromCharIndex) {
			var currentCharIndex;
			var currentChar;
			var inString = false;

			for (currentCharIndex = fromCharIndex; currentCharIndex < filter.length; currentCharIndex++) {
				currentChar = filter[currentCharIndex];

				if (currentChar === "'") {
					inString = !inString;
				} else if (!inString && currentChar === logicalTokenPrefix) {
					break;
				}
			}

			return currentCharIndex;
		}
	}

	return {
		tokenize: tokenize,
		logicalTokenPrefix: logicalTokenPrefix
	};
});
/**
 * @class Data.QueryBuilder
 * @private
 *
 * Used for building of SQL select queries.
 */

define('Data/QueryBuilder',[
	"underscore",
	"AH",
	"Data/FilterTokenizer",
	"DataModel/ModelField"
], function(_, AH, filterTokenizer, ModelField) {
	"use strict";

	/**
	 * @method buildCountQuery
	 * @private
	 *
	 * Builds a `'SELECT COUNT(*) FROM ... WHERE ...'` query for the given
	 * `modelClass`
	 *
	 * @param {DataModel.Class} modelClass
	 *
	 * {@link DataModel.Class} to count.
	 *
	 * @param {String} filter
	 *
	 * Logical filter used for count.
	 *
	 * @returns {string}
	 *
	 * SQL statement.
	 */
	function buildCountQuery(modelClass, filter) {

		var query = "SELECT COUNT(*) FROM " + buildFromClause(modelClass) + buildJoinsAndConditions(modelClass, { filter: filter });
		return query;
	}

	/**
	 * @method buildSelectQuery
	 *
	 * Builds a `'SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT'` query
	 * for the given parameters.
	 *
	 * @param {DataModel.Class} modelClass
	 *
	 * @param {Object} queryOptions
	 *
	 * Options supplied to {@link MDO.Collection#fetch}.
	 *
	 * @param {String} [queryOptions.filter]
	 *
	 * Logical filter.
	 *
	 * @param {String} [queryOptions.orderBy]
	 *
	 * Sort order.
	 *
	 * @param {Number} [queryOptions.offset=0]
	 *
	 * Starting row number
	 *
	 * @param {Number} [queryOptions.limit]
	 *
	 * Maximum number of rows.
	 *
	 * @returns {String}
	 *
	 * SQL statement.
	 *
	 *
	 * ### Example:
	 *  * modelClass: WorkRequest:Xact
	 *  * queryOptions.filter: $ahAssetRef.ahAsset = ? and $ahAssetRef.ahType = ?
	 *  * queryOptions.orderBy: $ahAssetRef.ahName DESC
	 *  * queryOptions.limit: 5
	 *  * queryOptions.offset: 4
	 *  * queryOptions.fields: ["ahWorkRequest", "ahAsset"]
	 *
	 *	returns:
	 *
	 *		SELECT WorkRequest.Pkey,
	 *			WorkRequest.ahWorkRequest,
	 *			WorkRequest.ahAsset
	 *		FROM WorkRequest
	 *		JOIN Xact ON Xact.PKey = WorkRequest.Pkey
	 *		JOIN Asset AHE_MT0 ON AHE_MT0.PKey = WorkRequest.ahAssetRefKey
	 *		WHERE AHE_MT0.ahAsset = ? and AHE_MT0.ahType = ?
	 *		ORDER BY AHE_MT0.ahAssetName DESC
	 *		LIMIT 5
	 *		OFFSET 4
	 */
	function buildSelectQuery(modelClass, queryOptions) {

		return buildInheritanceSelectQuery(modelClass, queryOptions) + buildJoinsAndConditions(modelClass, queryOptions) + buildLimit() + buildOffset();

		function buildLimit() {
			if (!queryOptions || AH.isEmpty(queryOptions.limit) || !AH.isDefined(queryOptions.limit)) {
				return "";
			}
			if (!_.isNaN(queryOptions.limit) && _.isFinite(queryOptions.limit) && queryOptions.limit > 0) {
				return " LIMIT " + queryOptions.limit;
			}
			throw new Error("Invalid LIMIT value: " + queryOptions.limit);
		}

		function buildOffset() {
			if (!queryOptions || AH.isEmpty(queryOptions.offset) || !AH.isDefined(queryOptions.offset)) {
				return "";
			}
			if (!_.isNaN(queryOptions.offset) && _.isFinite(queryOptions.offset) && queryOptions.offset >= 0) {
				return " OFFSET " + queryOptions.offset;
			}
			throw new Error("Invalid OFFSET value: " + queryOptions.offset);
		}

	}


	/**
	 * @method buildJoinsAndConditions
	 * @private
	 *
	 * Builds a 'WHERE ... ORDER BY ...' SQL fragment
	 *
	 * @param {DataModel.Class} modelClass
	 *
	 * Model class to query for.
	 *
	 * @param {Object} queryOptions
	 *
	 * Options supplied to {@link MDO.Collection#fetch}.
	 *
	 * @param {String} [queryOptions.filter]
	 *
	 * Logical filter.
	 *
	 * @param {String} [queryOptions.orderBy]
	 *
	 * Sort order.
	 *
	 * @returns {String}
	 *
	 * SQL fragment (`'WHERE ... ORDER BY ...'`)
	 */
	function buildJoinsAndConditions(modelClass, queryOptions) {
		if (!queryOptions || (!queryOptions.filter && !queryOptions.orderBy)) {
			return "";
		}

		var joinClauses = "";
		var joinManager = new JoinManager();
		// See FogBugz Case 1079 for explanation of default join type
		var parsedFilter = parseLogicalExpression(modelClass, queryOptions.filter, joinManager, (/\sOR\s/i).test(queryOptions.filter) ? "LEFT OUTER JOIN" : "JOIN");
		var parsedOrderBy = parseLogicalExpression(modelClass, queryOptions.orderBy, joinManager, "LEFT OUTER JOIN");

		_.each(joinManager.joins, function(join) {
			joinClauses += " " + join.type + " " + join.table + " " + join.tableAlias + " ON " + join.condition;
		});

		if (queryOptions.filter) {
			joinClauses += " WHERE " + parsedFilter;
		}
		if (queryOptions.orderBy) {
			joinClauses += " ORDER BY " + parsedOrderBy;
		}
		return joinClauses;
	}


	/**
	 * @method buildInheritanceSelectQuery
	 *
	 * Builds a 'SELECT ... FROM ...' for the given class (based on inheritance)
	 * Only includes the PKey column from 'modelClass', base class PKey fields are ignored.
	 *
	 * @param {DataModel.Class} modelClass
	 *
	 * Model class to query for.
	 *
	 * @param {Object} queryOptions
	 *
	 * Options supplied to {@link MDO.Collection#fetch}.
	 *
	 * @param {String} [queryOptions.filter]
	 *
	 * Logical filter.
	 *
	 * @param {String} [queryOptions.orderBy]
	 *
	 * Sort order.
	 *
	 * @returns {String}
	 *
	 * SQL statement.
	 *
	 * ### Example:
	 *
	 * Asset doesn't inherit form any classes and no `option.fields` specified
	 *
	 *  * modelClass: Asset
	 *
	 * returns:
	 *
	 *      SELECT Asset.* FROM Asset
	 *
	 * ### Example:
	 *
	 * If `option.fields` is defined, only selects those fields and the ID field
	 *
	 *  * modelClass: Asset
	 *  * queryOptions.fields: ["ahAsset", "ahExUid"]
	 *
	 * returns:
	 *
	 *      SELECT Asset.PKey, Asset.ahAsset, Asset.ahExUid FROM Asset
	 *
	 * ### Example:
	 *
	 * WorkRequest inherits from Xact
	 *
	 *  * modelClass: WorkRequest:Xact
	 *
	 * returns:
	 *
	 *      SELECT WorkRequest.*, Xact.ahType, ...
	 *          FROM WorkRequest JOIN Xact ON WorkRequest.PKey = Xact.PKey
	 */
	function buildInheritanceSelectQuery(modelClass, queryOptions) {
		queryOptions = queryOptions || {};
		var tables = buildFromClause(modelClass);
		var modelFields = modelClass.allFields;
		var fields = queryOptions.fields;
		if (fields) {
			var idField = modelClass.idField;
			if (fields.indexOf(idField.name) === -1) {
				fields.unshift(idField.name);
			}
			modelFields = _.map(fields, function (field) {
				return modelFields.getByName(field, true);
			});
		} else {
			if (modelClass.baseClass) {
				// Get all base class fields except for PKey
				modelFields = _.filter(modelClass.baseClass.allFields, function(field) {
					return !field.isIdField();
				});
			} else {
				modelFields = [];
			}
			// Add all fields from current class
			modelFields.unshift({
				modelClass: modelClass,
				name: "*"
			});
		}
		var columns = _.map(modelFields, function(field) {
			return field.modelClass.name + "." + field.name;
		});

		return "SELECT " + columns.join(", ") + " FROM " + tables;
	}

	/**
	 * @method buildFromClause
	 * @private
	 *
	 * Traverses the inheritance hierarchy of 'modelClass' and builds the FROM
	 * clause by joining to any parent classes
	 *
	 * @param {DataModel.Class} modelClass
	 *
	 * @returns {string}
	 *
	 * SQL Fragment.
	 */
	function buildFromClause(modelClass) {
		var prevClass;
		var from = "";
		modelClass.inheritance.forEach(function(cl) {
			if (!prevClass) {
				from += cl.name;
			} else {
				from += " JOIN " + cl.name + " ON " + prevClass.name + ".PKey = " + cl.name + ".PKey";
			}

			prevClass = cl;
		});

		return from;
	}

	/**
	 * @method parseLogicalExpression
	 *
	 * @param {DataModel.Class} modelClass
	 * @param {String} expression
	 * @param {Data.QueryBuilder.JoinManager} joinManager
	 * @param {String} defaultJoinType
	 * @returns {String}
	 *
	 * SQL column expression
	 */
	function parseLogicalExpression(modelClass, expression, joinManager, defaultJoinType) {
		// Tokenize logical filter
		var tokens = filterTokenizer.tokenize(expression);

		return _.map(tokens, processToken).join("");

		// Helper functions
		function processToken(token) {
			if (token && token.charAt(0) === filterTokenizer.logicalTokenPrefix) {
				return processLogicalToken(token);
			}

			return token;
		}

		function processLogicalToken(token) {
			if (token === filterTokenizer.logicalTokenPrefix) {
				token = modelClass.idField.name;
			} else {
				// Skip the '$' (e.g. '$ahAssetRef.ahAsset' => 'ahAssetRef.ahAsset')
				token = token.substring(1);
			}

			// Split the fields (e.g. 'ahAssetRef.ahAsset' => ['ahAssetRef', 'ahAsset']
			var fields = token.split(".");

			var referringClass = modelClass;
			var referringClassJoinAlias;

			var referencedClass;
			var referencedClassJoinAlias;
			var joinDescriptor = filterTokenizer.logicalTokenPrefix + referringClass.name;

			for (var i = 0; i < fields.length - 1; i++) {
				var referringElt = referringClass.allElements.getByName(fields[i], true);

				if (!referringClassJoinAlias) {
					referringClassJoinAlias = referringElt.modelClass.name;
				}

				var referencedEltOrFieldName = fields[i + 1];
				var referencedEltOrField = referringElt.refClass.getEltOrFieldByName(referencedEltOrFieldName, true);
				referencedClass = referencedEltOrField.modelClass;

				joinDescriptor += ":" + referringElt.name + ":" + referencedClass.name;

				if (!joinManager.hasExistingJoin(joinDescriptor)) {
					referencedClassJoinAlias = joinManager.createTableAlias(joinDescriptor);

					joinManager.addJoin(joinDescriptor, {
						table: referencedClass.name,
						tableAlias: referencedClassJoinAlias,
						type: defaultJoinType,
						condition: referencedClassJoinAlias + "." + referencedClass.idField.name + " = " + referringClassJoinAlias + "." + referringElt.referenceField.name
					});
				} else {
					joinManager.restrictJoin(joinDescriptor, defaultJoinType);
					referencedClassJoinAlias = joinManager.getTableAlias(joinDescriptor);
				}

				referringClass = referencedClass;
				referringClassJoinAlias = referencedClassJoinAlias;
			}

			// Convert the last field to a physical field
			// The last field could be a physical field (e.g. $ahAssetRef.ahAsset)
			// or it could be an element (e.g. $ahAssetRef)
			var lastFieldName = fields[fields.length - 1];

			var lastField = referringClass.getEltOrFieldByName(lastFieldName, true);
			var lastFieldTableAlias = (referringClassJoinAlias || lastField.modelClass.name);
			var lastFieldPhysicalName = lastField.referenceField ? lastField.referenceField.name : lastField.name;

			return lastFieldTableAlias + "." + lastFieldPhysicalName;
		}
	}

	return {
		buildCountQuery: buildCountQuery,
		buildInheritanceSelectQuery: buildInheritanceSelectQuery,
		buildSelectQuery: buildSelectQuery,
		_internal: {
			buildJoinsAndConditions: buildJoinsAndConditions
		}
	};

	/**
	 * @class Data.QueryBuilder.JoinManager
	 * @private
	 * @constructor
	 *
	 * Class used by QueryBuilder to manage a set of joins being created
	 * while processing a logical filter.
	 *
	 *
	 *	* Creates table aliases for joins (AHE_MT0, AHE_MT1, ...)
	 *	* Can keep track of joins that have been added if a 'join descriptor' is used when adding the join.
	 *  * Detects the use of duplicate table aliases for joins, and throws an exception
	 *
	 * A 'join descriptor' should be a unique string identifier for a particular join.
	 */
	function JoinManager() {
		var generatedAliasSuffix = 0;

		// Hashset of table aliases for joins that have been added to this manager.
		// Used as a quick way to see which aliases have already been used in order to detect duplicates.
		var existingTableAliases = { };

		// Maps join descriptors which have been added to this manager, to their corresponding joins.
		// Used as an easy way to see if a join has already been added for the corresponding join descriptor.
		// Prevents duplicate joins from being added for filters like $ahAssetRef.ahAsset = '0123' or $ahAssetRef.ahAsset = '0124'
		var joinDescriptorToJoinMap = { };

		// Creates a new table alias
		function createTableAlias() {
			return "AHE_MT" + generatedAliasSuffix++;
		}

		// ### getTableAlias(joinDescriptor)
		//
		// returns: The table alias that was used by the join with the given descriptor,
		//	or 'undefined' if a join with the given descriptor hasn't been added to the manager.
		//
		function getTableAlias(joinDescriptor) {
			var join = joinDescriptorToJoinMap[joinDescriptor];
			return join === undefined ? undefined : join.tableAlias || join.table;
		}

		// ### hasExistingJoin(joinDescriptor)
		//
		// returns: True if a join with the given 'joinDescriptor' was added to the manager, false otherwise.
		//
		function hasExistingJoin(joinDescriptor) {
			return Boolean(joinDescriptorToJoinMap[joinDescriptor]);
		}

		// ### addJoin(joinDescriptor, join)
		//
		// Adds a given join to the list of joins, and uniquely identifies it using a provided 'join descriptor'
		//
		// Throws an error if:
		//	* A join with 'joinDescriptor' has already been added
		//	* The join's table alias has already been used by another join
		//	* No join descriptor is provided
		//
		function addJoin(joinDescriptor, join) {
			var tableAlias = join.tableAlias || join.table;

			if (!joinDescriptor) {
				throw new Error("No join descriptor provided");
			}

			if (joinDescriptorToJoinMap[joinDescriptor]) {
				throw new Error("Duplicate use of join descriptor  '" + joinDescriptor + "'");
			}

			if (existingTableAliases[tableAlias]) {
				throw new Error("Duplicate use of table alias '" + tableAlias + "'");
			}

			// Mark join descriptor as having been used
			joinDescriptorToJoinMap[joinDescriptor] = join;

			// Mark join alias as having been used
			existingTableAliases[tableAlias] = true;
		}


		var joinPriorities = {
			"LEFT OUTER JOIN": 1,
			"JOIN": 0
		};

		// ### restrictJoin(joinDescriptor, joinType)
		//
		// If the specified joinType has a lower value in joinPriorities than
		// the current joinType for that joinDescripter, then the joinType
		// will be replaced.
		//
		// Throws an error if:
		//  * No join descriptor is provided
		//  * A join with 'joinDescriptor' has not yet been added
		//
		function restrictJoin(joinDescriptor, joinType) {
			if (!joinDescriptor) {
				throw new Error("No join descriptor provided");
			}

			var join = joinDescriptorToJoinMap[joinDescriptor];
			if (!join) {
				throw new Error("Join descriptor  '" + joinDescriptor + "' does not have any join associated with it");
			}

			if (joinPriorities[join.type] > joinPriorities[joinType]) {
				join.type = joinType;
			}
		}

		return {
			createTableAlias: createTableAlias,
			getTableAlias: getTableAlias,
			hasExistingJoin: hasExistingJoin,
			addJoin: addJoin,
			restrictJoin: restrictJoin,
			get joins() {
				return _.values(joinDescriptorToJoinMap);
			}
		};
	}
});

define('Data/Store',[
	"AH",
	"MDO/Stats",
	"Data/AbstractStore",
	"Data/XactPromiseWrapper",
	"underscore",
	"Constants",
	"Data/QueryBuilder",
	"DataModel/Model",
	"Logging/logger",
	"Files/fs",
	"Files/Mtl"
], function (
	AH,
	Stats,
	AbstractStore,
	XactPromiseWrapper,
	_,
	Constants,
	queryBuilder,
	Model,
	logger,
	fs,
	Mtl
	) {

	"use strict";

	var MtlIdPurpose = {
		permanentId: "id",
		primaryTempId: "ptmp",
		foreignTempId: "ftmp",
		bothTempId: "btmp"
	};

	/**
	 * @class Data.Store
	 * Exposes access to local data in the form of rows and MTLs.
	 * @extends Data.AbstractStore
     *
	 * @private
	 */
	var Store = AbstractStore.extend({
		/**
		 * @constructor
		 * Creates a new Store instance
		 *
		 * @param {LocalStorage.DataStore} dsInfo
		 * Information for the DataStore such as Id, Name, and Series and Sequence numbers.
		 */
		constructor: function (dsInfo) {
			AbstractStore.prototype.constructor.call(this, dsInfo);
			this._closedRejectedPromise = AH.reject(new Error("Store is closed"));
			this._openPromise = this._closedRejectedPromise;
			this._isOpen = false;
			this._systemTablesRejectedPromise = AH.reject(new Error("The datastore's system tables have not been initialized"));
			this._systemTablesPromise = this._systemTablesRejectedPromise;
			this._isMtlXactInProgress = undefined;
		},
		/**
		 * @method open
		 * Opens the database as described by settings.
		 *
		 * @return {Promise.<Data.Store>}
		 * Promise that resolves with the Store
		 */
		open: function () {
			var self = this;
			if (self._openPromise !== self._closedRejectedPromise) {
				return self._openPromise;
			}

			self._openPromise = self._openDatabase()
				.then(_.bind(self._createSystemTables, self))
				.then(_.bind(self._loadSettings, self))
				.then(_.bind(self._loadModel, self))
				.then(_.bind(self._importIncomingMtlsFromFs, self))
				.then(function () {
					return self;
				});

			self._openPromise
				.then(function () {
					self._isOpen = true;
				}, _.bind(self.close, self));

			return self._openPromise;
		},
		/**
		 * @method reset
		 * Delete tables from DB and reset version to ""
		 *
		 * @param {boolean} partialReset
		 * If true, only a partial reset will occur. Otherwise,
		 * the internal database will be destroyed.
		 *
		 * @return {Promise.<Data.Store>}
		 * Promise that resolves with the Store
		 */
		reset: function (partialReset) {
			var self = this;
			var resetPromise;
			self._model = undefined;

			resetPromise = partialReset
				? self._openPromise.then(_.bind(self._performPartialReset, self))
				: self._openPromise
				.always(_.bind(self._openDatabase, self))
				.then(self._db.destroyDatabase)
				.then(function () {
					self._tempIdCache = undefined;
					self._systemTablesPromise = self._systemTablesRejectedPromise;
				});

			return resetPromise
				.then(function () {
					return self;
				});
		},
		/**
		 * @method close
		 * Closes the database
		 *
		 * @return {Promise.<Data.Store>}
		 * Promise that resolves with the Store
		 */
		close: function () {
			var self = this;
			return AbstractStore.prototype.close.call(self).then(function () {
				self._openPromise = self._closedRejectedPromise;
				self._isOpen = false;
				self._systemTablesPromise = self._systemTablesRejectedPromise;
			});
		},
		/**
		 * @method destroy
		 * Destroys all tables in database behind this Store. If the Store is open, then
		 * it will be closed.
		 *
		 * @return {Promise}
		 * Resolves when the Store has been destroyed.
		 */
		destroy: function () {
			var self = this;
			return self.reset()
				.then(function () {
					return self._vault.destroy();
				})
				.then(_.bind(self.close, self), function(err) {
					self.close();
					return AH.reject(err);
				});
		},
		/**
		 * @method applyMtlXacts
		 * Applies transactions in the `mtl`  to the database.
		 * Any 'delete' transactions for file elements will also remove the corresponding
		 * file from the store's vault.
		 *
		 * @param {Files.Mtl} mtl
		 *
		 * @return {Promise}
		 * Returns a promise that resolves when data transactions have been applied
		 */
		applyMtlXacts: function (mtl) {
			var self = this;
			if (!self._model) {
				return AH.reject(new Error("Data store does not have a model"));
			}

			var classes = self._model.classes;

			return self._openPromise
				.then(function () {
					if (self._db.isTransactionBatchInProgress) {
						return processMtlXacts(self._db.inProgressBatchTransaction);
					}

					return self._transaction(function () {
						return processMtlXacts(self._db.inProgressBatchTransaction);
					});
				});

			function processMtlXacts(dbXact) {
				var index = 0;
				return processMtlXactBatch();

				function processMtlXactBatch() {
					var xactWrapper, promises;
					if (!mtl.getXact(index)) {
						// Nothing left to do
						return AH.resolve();
					}

					var mtlXact;
					promises = [];
					xactWrapper = new XactPromiseWrapper(dbXact);

					while ((mtlXact = mtl.getXact(index++))) {
						switch (mtlXact.t) {
							case Mtl.xactType.Begin:
							case Mtl.xactType.End:
								// Ignore - at least for now
								break;
							case Mtl.xactType.SharedDataVersion:
								// NOTE: Should echo back to server for propper SDV support.
								break;
							case Mtl.xactType.Create:
							case Mtl.xactType.CreateValidate:
								// Insert/update record
								var insertOp = insertStatement(mtlXact);
								xactWrapper.executeSql(insertOp.sql, insertOp.args);
								break;
							case Mtl.xactType.LocalCreate:
								// Upsert record
								var upsertOp = upsertStatement(mtlXact);
								xactWrapper.executeSql(upsertOp.sql, upsertOp.args);
								break;
							case Mtl.xactType.Update:
								// Update record
								if (mtlXact.set) {
									var updateOp = updateStatement(mtlXact);
									xactWrapper.executeSql(updateOp.sql, updateOp.args);
								}
								break;
							case Mtl.xactType.Delete:
								// Delete record
								promises.push(deleteVaultFiles(mtlXact));
								var deleteOp = deleteStatement(mtlXact);
								xactWrapper.executeSql(deleteOp.sql, deleteOp.args);
								break;
							case Mtl.xactType.Identity:
								promises.push(processResolveTempIdXact(dbXact, mtlXact));
								// We need to wait until DB has caught op with current transactions
								// since subsequent UPDATE/DELETE mtlXacts will use permanent IDs.
								return waitOnQueuedDbXacts();
							case Mtl.xactType.Sync:
								// Purge posted xacts and tempIds
								var inSeqNum = mtlXact.set[Store.MtlValueIds.inSequenceNum];
								promises.push(self.purgeOutgoingMtlXacts(self._dsSettings.inSeriesId(), inSeqNum));
								promises.push(self.purgeTempIdCache(inSeqNum));
								break;
							default:
								throw new Error("Unexpected MTL Xact Type: " + mtlXact.t);
						}
					}

					return waitOnQueuedDbXacts();

					// Returns a promise that resolves when all the xacts in xactWrapper have been applied
					// to the database
					function waitOnQueuedDbXacts() {
						xactWrapper.done();
						promises.push(xactWrapper.promise);
						return AH.whenAll(promises).then(processMtlXactBatch);
					}

					// deletes any vault files for the given rows
					function deleteVaultFileIfExists(modelClass, rows) {
						var removePromises = [];
						_.forEach(rows, function(row) {
							removePromises.push(self._vault.removeFile(modelClass, row.ahFileName, true));
						});
						return AH.whenAll(removePromises);
					}

					// deletes vault files for the mtlXact, excluding locally created files
					// that have not yet been sent to the server.
					function deleteVaultFiles(mtlFileXact) {
						var deletePromises = [];
						var modelClass = classes.getByClassId(mtlFileXact.classId);
						if (modelClass.isFileClass) {
							deletePromises.push(getVaultFilesToRemove(modelClass, mtlFileXact)
								.then(_.partial(deleteVaultFileIfExists, modelClass)));
						}
						return AH.whenAll(deletePromises);
					}

					// #### getVaultFilesToRemove(modelClass, mtlXact)
					//
					// Returns a {Promise} that resolves with an array of rows
					// whose vault files should be removed.
					//
					function getVaultFilesToRemove(modelClass, mtlFileXact) {
						if (mtlFileXact.id) {
							var filter = {};
							_.keys(mtlFileXact.id).forEach(function (fieldId) {
								filter[modelClass.fields.getByFieldId(fieldId).name] = mtlFileXact.id[fieldId];
							});
							return self.getRows({
								className: modelClass.name,
								filter: filter
							});
						}

						return self.getRows({
							className: modelClass.name,
							filter: modelClass.idField.name + " > ? AND ahCurrentUploadTS IS NULL",
							filterParams: [0]
						});
					}
				}
			}

			// ### getDbValues(fields, xactValues)
			//
			// When xactValues contains fields that have have
			// special identifiers (e.g. Blobs), they need to be
			// removed before the values can be inserted by WebSQL
			//
			// Returns an array of values that can be inserted into
			// a WebSQL database

			function getDbValues(fields, xactValues) {
				var toReturn = [];
				_.keys(xactValues).forEach(function (key) {
					var field = fields.getByFieldId(key);
					toReturn.push(Store.mtlToDbValue(field, xactValues[key]));
				});
				return toReturn;
			}

			// #### insertStatement(mtlXact)
			//
			// When `mtlXact.t == "CV"`, returns an 'INSERT OR REPLACE' statement.
			//
			// Returns an `{ sql: 'INSERT INTO ...', args: [...] }` object
			// based on on `mtlXact.set` array
			//

			function insertStatement(mtlXact) {
				var modelClass = classes.getByClassId(mtlXact.classId);
				var fieldIds = _.keys(mtlXact.id).concat(_.keys(mtlXact.set || {}));

				var setDbValues = getDbValues(modelClass.fields, mtlXact.set || {});
				var fieldValues = _.values(mtlXact.id).concat(setDbValues);

				var columns = _.map(fieldIds, function (fieldId) {
					return this.getByFieldId(fieldId).name;
				}, modelClass.fields);

				var values = _.map(columns, function () { return "?"; });
				var cmd = "INSERT OR REPLACE";
				return {
					sql: cmd + " INTO " + modelClass.name + " (" + columns.join(",") + ") VALUES (" + values.join(",") + ")",
					args: fieldValues
				};
			}

			// #### upsertStatement(mtlXact)
			//
			// Returns a statement that performs a proper UPSERT operation
			// The statement will preserve existing values of not-specified columns
			// rather than resetting them to null the way an `INSERT OR REPLACE` would.
			//
			// Based on http://stackoverflow.com/questions/418898/sqlite-upsert-not-insert-or-replace/7511635#7511635
			//
			//	INSER OR REPLACE INTO tableName
			//		(PKey, Field1, Field2, Field3, LocalField1, LocalField2)
			//	SELECT
			//		new.PKey, new.Field1, new.Field2, new.Field3, old.LocalField2, old.LocalField2
			//	FROM ( SELECT
			//		? AS PKey,
			//		? AS Fiedl1,
			//		? AS Field2,
			//		? AS Field3
			//	) AS new
			//	LEFT JOIN (
			//		SELECT Localfield1, LocalField2 FROM tableName
			//	) AS old
			//  ON new.PKey = old.PKey
			//
			function upsertStatement(mtlXact) {
				var modelClass = classes.getByClassId(mtlXact.classId);
				var newFieldIds = _.keys(mtlXact.id).concat(_.keys(mtlXact.set || {}));
				var oldFieldIds = _.difference(_.map(_.pluck(modelClass.fields, "fieldId"), String), newFieldIds);

				if (oldFieldIds.length === 0) {
					// We use INSERT OR REPLACE
					return insertStatement(mtlXact);
				}

				var newCols = _.map(newFieldIds, getColumnName);
				var oldCols = _.map(oldFieldIds, getColumnName);
				var idCol = newCols[0];
				var newFieldValues = _.values(mtlXact.id).concat(getDbValues(modelClass.fields, mtlXact.set || {}));

				return {
					sql: "INSERT OR REPLACE INTO " + modelClass.name
					+ " (" + newCols.join(", ") + ", " + oldCols.join(", ") + ")"
					+ " SELECT " + _.map(newCols, newColName).join(", ") + ", " + _.map(oldCols, oldColName).join(", ")
					+ " FROM ( SELECT " + _.map(newCols, colParam).join(", ") + ") AS new LEFT JOIN"
					+ " (SELECT " + idCol + ", " + oldCols.join(", ") + " FROM " + modelClass.name + ") AS old"
					+ " ON " + newColName(idCol) + " = " + oldColName(idCol),
					args: newFieldValues
				};

				function getColumnName(fieldId) {
					return modelClass.fields.getByFieldId(fieldId).name;
				}

				function newColName(col) {
					return "new." + col;
				}

				function oldColName(col) {
					return "old." + col;
				}

				function colParam(col) {
					return "? AS " + col;
				}
			}

			// #### deleteStatement(mtlXact)
			//
			// Returns an `{ sql: 'DELETE FROM ...', args: [...] }` object
			// based on `mtlXact.id`
			//

			function deleteStatement(mtlXact) {
				var modelClass = classes.getByClassId(mtlXact.classId);

				var filter = statementFilter(modelClass, mtlXact);

				return {
					sql: "DELETE FROM " + modelClass.name + filter.where,
					args: filter.args
				};
			}

			// #### updateStatement(mtlXact)
			//
			// Returns an `{ sql: 'UPDATE ...', args: [...] }` object
			// based on `mtlXact.id` and `mtlXact.set`
			//

			function updateStatement(mtlXact) {
				var modelClass = classes.getByClassId(mtlXact.classId);
				var updates = _.keys(mtlXact.set || {}).map(function (fieldId) {
					return this.getByFieldId(fieldId).name + "=?";
				}, modelClass.fields);

				var filter = statementFilter(modelClass, mtlXact);
				var setDbValues = getDbValues(modelClass.fields, mtlXact.set || {});

				return {
					sql: "UPDATE " + modelClass.name + " SET " + updates.join(",") + filter.where,
					args: setDbValues.concat(filter.args)
				};
			}

			// #### processResolveTempIdXact(dbXact, mtlXact)
			//
			// Update the database to resolve tempId references
			// based on `mtlXact.id` and `mtlXact.set`
			//

			function processResolveTempIdXact(dbXact, mtlXact) {
				var baseClass = classes.getByClassId(mtlXact.classId);
				var fieldId = baseClass.idField.fieldId;
				var tempId = mtlXact.id[fieldId];
				var permId = mtlXact.set[fieldId];
				var classesToCheck = [baseClass];
				var currentClass;

				// Add to tempId cache
				var cacheUpdatePromise = self.cacheTempId(tempId, permId, dbXact);

				var xactWrapper = new XactPromiseWrapper(dbXact);
				// Echo transaction to server
				var statement = self._mtlXactSqlStatement(self.newMtlResolveTempIdXact(baseClass, tempId, permId));
				xactWrapper.executeSql(statement.sql, statement.args);

				// Start resolving with the base class
				resolveClassTempId(dbXact);

				return AH.whenAll([cacheUpdatePromise, xactWrapper.promise]);

				function resolveClassTempId(xact, rs) {
					// test if currentClass was a match
					if (rs && rs.rowsAffected) {

						// update records that are referncing this element
						var elts = currentClass.referencingElements;
						if (elts) {
							elts.forEach(function (elt) {
								xactWrapper.executeSql(updateFieldSql(elt.referenceField), [permId, tempId]);
							});
						}

						// check classes that derived from it
						classesToCheck = currentClass.derivedClasses.slice();
					}

					// try to resolve next class
					currentClass = classesToCheck.pop();

					if (currentClass) {
						xactWrapper.executeSql(updateFieldSql(currentClass.idField), [permId, tempId], resolveClassTempId);
					} else {
						xactWrapper.done();
					}
				}

				function updateFieldSql(field) {
					return "UPDATE " + field.modelClass.name
						+ " SET " + field.name + "=?"
						+ " WHERE " + field.name + "=?";
				}
			}

			// #### statementFilter(modelClass, mtlXact)
			//
			// Returns an `{ where: 'WHERE ...', args: [...] }` object
			// based on `mtlXact.id`
			//
			// If no `id` is specified, returns `{ where: '', args: [] }`
			//

			function statementFilter(modelClass, mtlXact) {
				if (mtlXact.id) {
					var conditions = _.keys(mtlXact.id).map(function (fieldId) {
						return this.getByFieldId(fieldId).name + "=?";
					}, modelClass.fields);

					return {
						where: " WHERE (" + conditions.join(" AND ") + ")",
						args: _.values(mtlXact.id)
					};
				}
				return { where: "", args: [] };
			}
		},
		/**
		 * @method getCount
		 * @async
		 *
		 * Get the number of Rows matching the given filter.
		 *
		 * @param className
		 *
		 * @param {string|Object} [filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @return {Promise.<number>}
		 * a promise that resolves with the count of 'className' records that match 'filter'
		 */
		getCount: function (className, filter, filterParams) {
			var self = this;
			return self._openPromise
				.then(function () {
					var modelClass = self.getModelClass(className);
					var parsedFilter = Store.parseFilter(filter, filterParams, modelClass);
					return self._fetchCount(modelClass, parsedFilter);
				});
		},
		/**
		 * @method _fetchCount
		 * @private
		 * @async
		 *
		 * Count the number of records identified by modelClass and parsedFilter.
		 *
		 * @param {DataModel.Class} modelClass
		 *
		 * @param {Object} parsedFilter
		 *
		 * @return {Promise.<number>}
		 * a promise that resolves with the count of 'className' records that match 'filter'
		 */
		_fetchCount: function(modelClass, parsedFilter) {
			var sql = queryBuilder.buildCountQuery(modelClass, parsedFilter.filter);
			return this._db.read(sql, parsedFilter.filterParams)
				.then(function (rs) {
					var item = rs.rows.item(0);
					return Number(item[_.keys(item)[0]]);
				});
		},
		/**
		 * @method _readRows
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @private
		 * @async
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the rows
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object.<string,string|number>} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @param {boolean} [config.totalCount=false]
		 * Set the `totalCount` property of returned `rows`.
		 *
		 * @param {Object.<string,string>} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string} [config.queryOptions.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array.<string>} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		_readRows: function (config) {
			var self = this;
			return self._openPromise
				.then(function () {
					var modelClass = self.getModelClass(config.className);
					var parsedFilter = Store.parseFilter(config.filter, config.filterParams, modelClass);
					var sql = queryBuilder.buildSelectQuery(modelClass, _.extend({}, config.queryOptions, parsedFilter));
					return self._db.read(sql, parsedFilter.filterParams)
						.then(deserializeResults);


					function deserializeResults(rs) {
						var results = [], result, row;
						for (var i = 0; i < rs.rows.length; i++) {
							row = rs.rows.item(i);
							// SqlRow object doesn't let you set values, so create a new object to return
							result = {};
							_.keys(row).forEach(deserialize);
							results.push(result);
						}
						Stats.updateStat("READ", config.className, results.length);
						if (config.totalCount) {
							return self._fetchCount(modelClass, parsedFilter)
								.then(function(count) {
									results.totalCount = count;
									return results;
								});
						}

						return results;

						function deserialize(key) {
							var field = modelClass.allFields.getByName(key);
							result[key] = field.valueFromDb(row[key]);
						}
					}
				});
		},
		/**
		 * @method insertElement
		 *
		 * Generates a new tempId and inserts `values` for the `modelClass` element.
		 * Inserts records tables up the inheritance chain.
		 *
		 * @param {DataModel.Class} modelClass
		 * modelClass to create a row for
		 *
		 * @param {Object} values
		 * POJO containing values by column name
		 *
		 * @param {boolean} localOnly
		 * if True, no transactions will be generated for the creation of this row
		 *
		 * @return {Promise.<Row>}
		 * Resolves with the inserted row.
		 */
		insertElement: function (modelClass, values, localOnly) {
			var self = this;
			return self._openPromise.then(function () {
				if (!modelClass) {
					throw new Error("No class specified.");
				}
				if (!values) {
					throw new Error("No values specified.");
				}
				// Verify that PKey is not already set
				var idField = modelClass.idField;
				var idValue = values[idField.name];
				if (idValue) {
					throw new Error(modelClass.name + "." + idField.name + " should be undefined (" + JSON.stringify(idValue) + ").");
				}

				// serialize values
				var serializedValues = {};
				_.keys(values).forEach(function (key) {
					var field = modelClass.allFields.getByName(key);
					serializedValues[key] = field.valueToDb(values[key]);
				});

				// Grab a new tempId
				return self._dsSettings.generateNextTempId()
					.then(function (tempId) {
						var statements = [];
						var hasMtlXacts = false;
						modelClass.inheritance.forEach(function (cl) {
							// Collect defined values for this `cl`
							var insertValues = {};
							cl.fields.forEach(function (field) {
								var value;
								if (field.isIdField()) {
									value = tempId;
								} else {
									value = serializedValues[field.name];
								}
								if (!_.isUndefined(value)) {
									insertValues[field.name] = value;
								}
							});

							// Create INSERT statement for this `cl`
							var columns = _.keys(insertValues);
							var sql = "INSERT INTO " + cl.name + " ("
								+ columns.join(",")
								+ ") VALUES ("
								+ _.range(columns.length).map(function () { return "?"; }).join(",")
								+ ")";
							statements.push({
								sql: sql,
								args: _.values(insertValues)
							});

							// Log MTL transaction (in reverse order!)
							var mtlXact = self.newMtlCreateXact(cl, insertValues, localOnly);
							if (mtlXact) {
								Stats.updateStat("CREATE", cl.name);
								statements.unshift(self._mtlXactSqlStatement(mtlXact));
								hasMtlXacts = true;
							}
						});

						return self._db.execute(hasMtlXacts ? self._mtlXactStatementBlock(statements) : statements)
							.then(fetchElement);

						function fetchElement() {
							var filter = {};
							filter[idField.name] = tempId;
							return self.getRow({
								className: modelClass.name,
								filter: filter
							});
						}
					});
			});
		},
		/**
		 * @method updateElement
		 *
		 * Updates modified `values` in an existing `modelClass` element.
		 * `originalValues` allow the store to determine which values have changed.
		 * `localOnly` suppresses the generation of MTL transactions.
		 *
		 * @param {DataModel.Class} modelClass
		 * modelClass to update a row for
		 *
		 * @param {Object.<string,string|number>} values
		 * POJO containing new values by column name
		 *
		 * @param {Object.<string,string|number>} originalValues
		 * POJO containing original values by column name
		 *
		 * @param {boolean} localOnly
		 * if True, no transactions will be generated for this update.
		 *
		 * @return {Promise.<Row>}
		 * Resolves with the updated row.
		 */
		updateElement: function (modelClass, values, originalValues, localOnly) {
			var self = this;
			return self._openPromise
				.then(function () {
					if (!modelClass) {
						throw new Error("No class specified.");
					}
					if (!values) {
						throw new Error("No values specified.");
					}

					var updateStatements = [];
					var classFilter;
					var hasMtlXacts = false;
					modelClass.inheritance.forEach(function (cl) {
						classFilter = cl.getIdFilter(values);
						var changed = cl.pluckOwnAttributes(values);
						var original = _.extend({}, originalValues, classFilter);

						// Remove unchanged values
						_.keys(changed).forEach(function (key) {
							// Use _.isEqual() properly compare Date and Blob values
							if (_.isEqual(changed[key], original[key])) {
								delete changed[key];
							} else {
								var field = cl.fields.getByName(key);
								changed[key] = field.valueToDb(changed[key]);
							}
						});

						// Create UPDATE statement
						if (!_.isEmpty(changed)) {
							var args = [];
							var sql = "UPDATE "
								+ cl.name
								+ " SET " + self._buildSqlAssignmentArray(changed, args).join(",")
								+ " WHERE " + self._buildSqlAssignmentArray(classFilter, args).join(" AND ");
							updateStatements.push({
								sql: sql,
								args: args
							});

							// Log MTL transaction
							var mtlXact = self.newMtlUpdateXact(cl, classFilter[cl.idField.name], changed, localOnly);
							if (mtlXact) {
								Stats.updateStat("UPDATE", cl.name);
								updateStatements.push(self._mtlXactSqlStatement(mtlXact));
								hasMtlXacts = true;
							}
						}

					});

					if (updateStatements.length) {
						return self._db.execute(hasMtlXacts ? self._mtlXactStatementBlock(updateStatements) : updateStatements)
							.then(fetchRecord);
					}

					return fetchRecord();

					function fetchRecord() {
						return self.getRow({
							className: modelClass.name,
							filter: classFilter
						});
					}
				});
		},
		/**
		 * @method deleteElement
		 *
		 * Deletes the element identified by filter and cascades delete to records
		 * related via inheritance and ownership.
		 * `localOnly` suppresses the generation of MTL transactions.
		 *
		 * @param {DataModel.Class} modelClass
		 * modelClass to delete a row for
		 *
		 * @param {Object.<string, number>} filter
		 * POJO containing the key of the row to be deleted
		 *
		 * @param {boolean} localOnly
		 * if True, no transactions will be generated for this delete.
		 *
		 * @return {Promise}
		 * Resolves with array of deleted items { modelClass, id }
		 */
		deleteElement: function (modelClass, filter, localOnly) {
			var self = this;
			// SQL statements to execute all deletes
			var statements = [];
			var deletedItems = [];

			return self._openPromise
				.then(function () {
					if (!modelClass) {
						throw new Error("No class specified.");
					}
					if (!filter) {
						throw new Error("No filter specified.");
					}

					var id = filter[modelClass.idField.name];
					if (!id) {
						throw new Error("No id specified.");
					}

					return getInheritanceDeleteStatements(modelClass, id)
						.then(function () {
							if (statements.length) {
								return self._db.execute(localOnly ? statements : self._mtlXactStatementBlock(statements))
									.then(function() {
										return deletedItems;
									});
							}

							return deletedItems;
						});
				});

			// getInheritanceDeleteStatements(baseClass, id, existing)
			//
			// Calculates all the cascading delete statements needed to delete
			// the instance derived from `baseClass` with the specified id.
			//
			// When `existing` is false, verify that the `baseClass` record exists in the database
			//
			// Returns a promise that resolves when statements are calculated
			//

			function getInheritanceDeleteStatements(baseClass, id, existing) {

				return getInstanceClass(baseClass, id, existing)
					.then(function (instanceClass) {
						if (instanceClass) {
							deletedItems.push({
								modelClass: instanceClass,
								id: id
							});
							var p = AH.when();
							instanceClass.inheritance.forEach(function (cl) {
								p = p.then(function () {
									return getRowDeleteStatements(cl, id);
								});
							});
							return p;
						}

						return true;
					});
			}

			// getRowDeleteStatements(specificClass, id)
			//
			// Calculates the cascading delete statements needed to delete
			// the row of `specificClass` with the specified id and its owned records.
			//
			// Returns a promise that resolves when statements are calculated
			//

			function getRowDeleteStatements(rowClass, id) {
				// get delete statements from owned records
				var collectionPromises = [];
				rowClass.collections.forEach(function (col) {
					collectionPromises.push(getCollectionDeleteStatements(col, id));
				});

				return AH.whenAll(collectionPromises)
					.then(function () {
						// Add specificClass element's statement
						statements.push({
							sql: "DELETE FROM " + rowClass.name + " WHERE " + rowClass.idField.name + "=?",
							args: [id]
						});

						Stats.updateStat("DELETE", rowClass.name);

						if (!localOnly) {
							// Log MTL transaction
							var mtlXact = self.newMtlDeleteXact(rowClass, id);
							statements.push(self._mtlXactSqlStatement(mtlXact));
						}
					});
			}

			// getCollectionDeleteStatements(collection, id)
			//
			// Calculates the cascading delete statements needed to delete
			// the `collection` records owned by the specified id
			//
			// Returns a promise that resolves when statements are calculated
			//

			function getCollectionDeleteStatements(col, id) {
				var foreignClass = self._model.classes.getByClassId(col.colClassId);
				var foreignField = foreignClass.fields.getByFieldId(col.colParentId);
				var sql = "SELECT " + foreignClass.idField.name
					+ " AS id FROM " + foreignClass.name
					+ " WHERE " + foreignField.name + "=?";

				return self._db.read(sql, [id])
					.then(extractIds)
					.then(addElementStatements);

				function extractIds(rs) {
					var ids = [];
					var rows = rs.rows;
					for (var i = 0; i < rows.length; i++) {
						ids.push(rows.item(i).id);
					}
					return ids;
				}

				function addElementStatements(ids) {
					var p = AH.when();
					ids.forEach(function (elementId) {
						p = p.then(function () {
							return getInheritanceDeleteStatements(foreignClass, elementId, true);
						});
					});
					return p;
				}
			}

			// getInstanceClass(baseClass, id, existing)
			//
			// Determines the most-derived class for the `baseClass` with the specified id.
			//
			// When `existing` is false, verify that the record exists in the database
			//
			// Returns a promise that resolves with the most-derived model class or null.
			//

			function getInstanceClass(baseClass, id, existing) {
				return AH.when(existing || recordExists(baseClass), findDerivedClass, function () {
					// If we fail, resolve successfully with null
					return AH.resolve(null);
				});

				// Determines which of our derived classes contains `id`
				//
				// Determines the most-derived class for the `baseClass` with the specified id.
				//

				function findDerivedClass() {
					var derived = baseClass.derivedClasses;
					var derivedPromise = AH.when();
					var cl;
					for (var i = 0; i < derived.length; i++) {
						cl = derived[i];
						derivedPromise = derivedPromise.then(getClass);
					}
					return derivedPromise.then(function (instanceClass) {
						return instanceClass || baseClass;
					});

					function getClass(instanceClass) {
						return instanceClass || getInstanceClass(cl, id);
					}
				}

				// Determine whether a baseClass record with the specified `id` exists
				//
				// Returns a promise that succeeds if the record exists
				//

				function recordExists(recordClass) {
					// Validate that baseClass record exists
					var sql = "SELECT COUNT(*) AS cnt FROM " + recordClass.name
						+ " WHERE " + recordClass.idField.name + "=?";
					return self._readRow(sql, [id])
						.then(function (row) {
							if (!row.cnt) {
								return AH.reject(new Error("Record doesn't exist"));
							}

							return row;
						});
				}
			}
		},
		/**
		 * @method cacheTempId
		 *
		 * Store `tempid` resolved to `permid` in the "@tempid" table, using `dbXact` if specified
		 *
		 * @param {number} tempid
		 * temporary id to map to a permanent id
		 *
		 * @param {number} permid
		 * permanent id to map to a temporary id
		 *
		 * @param {Object} [dbXact]
		 * WebSQL Transaction during which the id mapping should be added.
		 *
		 * @return {Promise.<Object>}
		 * a promise that resolves with the updated cache
		 */
		cacheTempId: function (tempid, permid, dbXact) {
			var self = this;
			return self._retrieveTempIdCache().then(function (table) {
				table.add({
					sequence: self._dsSettings.inSeqNum(),
					tempid: tempid,
					permid: permid
				});
				return table.get(tempid).save(null, { xact: dbXact });
			});
		},
		/**
		 * @method getTempIdCache
		 *
		 * Gets lookup of currently cached tempids `{ tempId: permId }`
		 *
		 * @return {Promise.<Object>}
		 * Returns a promise that resolves with the lookup cache
		 */
		getTempIdCache: function () {
			return this._retrieveTempIdCache().then(function (table) {
				var cache = {};
				for (var i = 0; i < table.length; i++) {
					var row = table.at(i);
					cache[row.get("tempid")] = row.get("permid");
				}
				return cache;
			});
		},
		/**
		 * @method purgeTempIdCache
		 *
		 * Delete tempids whose sequence is <= `maxSeqNum` from the database
		 *
		 * @param {number} maxSeqNum
		 * Maximum value to allow for a tempid's sequence
		 *
		 * @return {Promise}
		 * A promsie that resolves when the purge is complete.
		 */
		purgeTempIdCache: function (maxSeqNum) {
			// should only clear on disk, not in memory.
			return this._retrieveTempIdCache().then(function (table) {
				return table.purgeTempIdCache(maxSeqNum);
			});
		},
		/**
		 * @method emptyTempIdCache
		 *
		 * Delete all cached tempids
		 *
		 * @return {Promise}
		 * A promise that resovles when the cache has been emptied.
		 */
		emptyTempIdCache: function () {
			// should clear on disk and in memory
			return this._retrieveTempIdCache().then(function (table) {
				return table.emptyTempIdCache();
			});
		},
		/**
		 * @method resolveTempId
		 * Looks up the permanent value of the temporary id, if it exists.
		 *
		 * @param {number} tempid
		 * Temporary Id to look up.
		 *
		 * @return {number}
		 * If it exists, return the permanent id for the given tempid.
		 * Otherwise, return the tempid.
		 */
		resolveTempId: function (tempid) {
			if (!this._tempIdCache) {
				throw new Error("TempIdCache has not been initialized. Please open the store and/or deploy a model.");
			}
			return this._tempIdCache.resolveTempId(tempid);
		},
		/**
		 * @method emptyMtlXactLog
		 *
		 * Delete all logged MTL transactions
		 *
		 * @return {Promise}
		 * A promise that resolves when the MtlXactLog has been emptied.
		 */
		emptyMtlXactLog: function () {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.execute('DELETE FROM "@xacts"');
				});
		},
		/**
		 * @method getOutgoingMtlXactRecords
		 *
		 * Return xacts records matching current series id that have not yet been posted
		 *
		 * @return {Promise.<Array>}
		 * Returns a promise that resolves with an array of rows
		 */
		getOutgoingMtlXactRecords: function () {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.read('SELECT * FROM "@xacts" WHERE series=? AND posted IS NULL ORDER BY id', [self._dsSettings.inSeriesId()])
						.then(_.bind(self._extractRowsFromResultSet, self));
				});
		},
		/**
		 * @method getPostedMtlXactRecordsInSequence
		 *
		 * Return xacts posted records matching current series id <= sequence
		 *
		 * @param {number} sequence
		 * Sequence to retrieve records for
		 *
		 * @return {Promise.<Array>}
		 * Returns a promise that resolves with an array of rows
		 */
		getPostedMtlXactRecordsInSequence: function (sequence) {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.read('SELECT * FROM "@xacts" WHERE series=? AND sequence <= ? AND posted IS NOT NULL ORDER BY id', [self._dsSettings.inSeriesId(), sequence])
						.then(_.bind(self._extractRowsFromResultSet, self));
				});
		},
		/**
		 * @method getAllPostedMtlXactRecords
		 *
		 * Return all xacts posted records
		 *
		 * @return {Promise.<Array>}
		 * Returns a promise that resolves with an array of rows
		 */
		getAllPostedMtlXactRecords: function () {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.read('SELECT * FROM "@xacts" WHERE series=? AND posted IS NOT NULL ORDER BY id', [self._dsSettings.inSeriesId()])
						.then(_.bind(self._extractRowsFromResultSet, self));
				});
		},
		/**
		 * @method postOutgoingMtlXacts
		 *
		 * Mark transactions in `series` and `sequence` as posted.
		 *
		 * @param {number} series
		 * Series for transactions to be posted from
		 *
		 * @param {number} sequence
		 * Sequence for transactions to be posted from
		 *
		 * @return {Promise}
		 * a promise that resolves when all outgoing mtl xacts have been posted
		 */
		postOutgoingMtlXacts: function (series, sequence) {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.execute('UPDATE "@xacts" SET posted = datetime() WHERE series=? AND sequence=?', [series, sequence]);
				});
		},
		/**
		 * @method purgeOutgoingMtlXacts
		 *
		 * Delete transactions in the specified `series` with `sequence <= maxSequence`.
		 *
		 * @param {number} series
		 * Series to delete outgoing transactions from
		 *
		 * @param {number} maxSequence
		 * Maximum sequence of outgoing transactions to delete
		 *
		 * @return {Promise}
		 * a promise that resolves when the outgoing transactions have been deleted.
		 */
		purgeOutgoingMtlXacts: function (series, maxSequence) {
			return this._db.execute('DELETE FROM "@xacts" WHERE series=? AND sequence <= ?',
				[series, maxSequence]);
		},
		/**
		 * @method purgeAllOutgoingXacts
		 *
		 * Deletes all xacts records
		 *
		 * @return {Promise}
		 * a promise that resolevs when all transactions in the current series
		 * have been deleted
		 */
		purgeAllOutgoingXacts: function () {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._db.execute('DELETE FROM "@xacts" WHERE series= ?', [self._dsSettings.inSeriesId()]);
				});
		},
		/**
		 * @method newMtlSyncXact
		 * Create an Object representing a Sync Transaction
		 *
		 * @param {number} sequence
		 * Sequence to use for the Transaction
		 *
		 * @return {Object.<string,string|Object>}
		 * MTL SYNC transaction for the upcoming inSeqNum
		 *
		 * @return {string} return.t
		 * MTL xactType
		 *
		 * @return {Object.<string,number>} return.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @return {number} return.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @return {number} return.set.5
		 * the MTL's 'in' Sequence Number
		 */
		newMtlSyncXact: function (sequence) {
			// Create transaction
			var mtlXact = {
				t: Mtl.xactType.Sync,
				set: {}
			};

			mtlXact.set[Store.MtlValueIds.inSeriesID] = this._dsSettings.inSeriesId();
			mtlXact.set[Store.MtlValueIds.inSequenceNum] = sequence;
			return mtlXact;
		},
		/**
		 * @method newMtlBeginXact
		 * Create an Object representing a Begin Transaction
		 *
		 * @return {Object.<string,string|Object>}
		 * MTL BEGIN transaction
		 *
		 * @return {string} return.t
		 * MTL xactType
		 */
		newMtlBeginXact: function () {
			return {
				t: Mtl.xactType.Begin
			};
		},
		/**
		 * @method newMtlCreateXact
		 * Create an Object representing a Create Transaction
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass to create a Transaction for
		 *
		 * @param {Object.<string,string|number>} values
		 * lookup containing to values to apply in the transaction
		 *
		 * @param {boolean} localOnly
		 * If true, transaction will not be sent to the server
		 *
		 * @return {Object.<string,string|number|Object>}
		 * MTL Create transaction for `values` in a `modelClass` element
		 */
		newMtlCreateXact: function (modelClass, values, localOnly) {
			if (localOnly === true) {
				return null;
			}

			// Get id from values
			var idName = modelClass.idField.name;
			var id = values[idName];
			// Remove id from values
			values = _.extend({}, values);
			delete values[idName];

			return this._newMtlUpsertXact(Mtl.xactType.Create, modelClass, id, values, localOnly);
		},
		/**
		 * @method newMtlUpdateXact
		 * Create an Object representing an Update Transaction
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass to create a Transaction for
		 *
		 * @param {number} id
		 * Value of the id field of the row to create a transaction for
		 *
		 * @param {Object.<string,string|number>} values
		 * lookup containing to values to apply in the transaction
		 *
		 * @param {boolean} localOnly
		 * If true, transaction will not be sent to the server
		 *
		 * @return {Object.<string,string|number|Object>}
		 * MTL Update transaction for `values` in a `modelClass` element with 'id'.
		 */
		newMtlUpdateXact: function (modelClass, id, changedValues, localOnly) {
			return this._newMtlUpsertXact(Mtl.xactType.Update, modelClass, id, changedValues, localOnly);
		},
		/**
		 * @method newMtlDeleteXact
		 * Create an Object representing a Delete Transaction
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass to create a Transaction for
		 *
		 * @param {number} id
		 * Value of the id field of the row to create a transaction for
		 *
		 * @return {Object.<string,string|number|Object>}
		 * Returns an MTL DELETE transaction for a `modelClass` element
		 * identified by `id`
		 */
		newMtlDeleteXact: function (modelClass, id) {
			return this._newMtlDataXact(Mtl.xactType.Delete, modelClass, id);
		},
		/**
		 * @method newMtlResolveTempIdXact
		 * Create an Object representing a Temp Id Resolution Transaction
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass to create a Transaction for
		 *
		 * @param {number} tempId
		 * Value of the temporary id field of the row to create a transaction for
		 *
		 * @param {number} permId
		 * Value of the permanent id field of the row to create a transaction for
		 *
		 * @return {Object.<string,string|number|Object>}
		 * Returns a ResolveTempID MTL xact for `modelClass` resolving `tempId` to `permId`
		 */
		newMtlResolveTempIdXact: function (modelClass, tempId, permId) {
			var mtlXact = {
				t: Mtl.xactType.Identity,
				classId: modelClass.classId,
				id: {},
				set: {}
			};

			var fieldId = modelClass.idField.fieldId;
			mtlXact.id[fieldId] = tempId;
			mtlXact.set[fieldId] = permId;

			return mtlXact;
		},
		/**
		 * @method newMtlEndXact
		 * Create an Object representing an End Transaction
		 *
		 * @return {Object.<string>}
		 * MTL END transaction object
		 *
		 * @return {string} return.t
		 * MTL xactType
		 */
		newMtlEndXact: function () {
			return {
				t: Mtl.xactType.End
			};
		},
		/**
		 * @method _importIncomingMtlsFromFs
		 * @private
		 * Imports all of the mtls from the datastore's incoming filesystem folder into the datastore repository
		 *
		 * @return {Promise}
		 * Promise that resolves when all incoming mtls have been imported
		 */
		_importIncomingMtlsFromFs: function () {
			var self = this;
			return self._systemTablesPromise
				.then(function () {
					return fs.listFiles(self._dsInfo.incomingDir(), "*.MTL");
				})
				.then(function (fileInfos) {
					var promise = AH.resolve();

					_.each(fileInfos, function (fileInfo) {
						promise = promise
							.then(function () {
								return fs.readJsonFileContent(fileInfo.path);
							})
							.then(_.bind(self._addIncomingMtl, self))
							.then(function () {
								return fs.deleteFile(fileInfo.path);
							});
					});

					return promise;
				});
		},
		/**
		 * @method _addIncomingMtl
		 * @private
		 * Adds an mtl (Mtl instance of json mtl) to the collection of incoming mtls for this datastore
		 *
		 * @param {Object.<string,string|Object>} mtl
		 * MTL to add to incoming MTls.
		 *
		 * @param {string} mtl.t
		 * MTL xactType
		 *
		 * @param {Object.<string, number>} mtl.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @param {number} mtl.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @param {number} mtl.set.5
		 * the MTL's 'in' Sequence Number
		 *
		 * @return {Promise}
		 * Promise that resolves when the mtl has been added successfully
		 */
		_addIncomingMtl: function (mtl) {
			var self = this;
			return self._systemTablesPromise
				.then(function () {
					var parsedMtl;
					if (mtl instanceof Mtl) {
						parsedMtl = mtl;
					} else {
						parsedMtl = Mtl.fromJSON(mtl);
					}

					return self._db.execute('INSERT OR REPLACE INTO "@incoming" (mtl, seriesId, seqNum, segmentIndex) VALUES (?, ?, ?, ?)', [
						JSON.stringify(parsedMtl.toJSON()),
						parsedMtl.seriesId,
						parsedMtl.seqNum,
						parsedMtl.segmentIndex || 0
					]);
				});
		},
		/**
		 * @method deleteIncomingMtl
		 * Deletes the given incoming mtl
		 *
		 * @param {Object.<string,string|Object>} mtl
		 * MTL to delete.
		 *
		 * @param {string} mtl.t
		 * MTL xactType
		 *
		 * @param {Object.<string, number>} mtl.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @param {number} mtl.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @param {number} mtl.set.5
		 * the MTL's 'in' Sequence Number
		 *
		 * @return {Promise}
		 * Promise that resolves when the incoming mtl has been deleted
		 */
		deleteIncomingMtl: function (mtl) {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._systemTablesPromise;
				})
				.then(function () {
					var parsedMtl;
					if (mtl instanceof Mtl) {
						parsedMtl = mtl;
					} else {
						parsedMtl = Mtl.fromJSON(mtl);
					}
					return self._db.execute('DELETE FROM "@incoming" WHERE seriesId = ? AND seqNum = ? AND segmentIndex = ?', [
						parsedMtl.seriesId,
						parsedMtl.seqNum,
						parsedMtl.segmentIndex || 0
					]);
				});
		},
		/**
		 * @method getIncomingMtl
		 * Retrieve the specified given incoming { seriesId, seqNum, segmentIndex } mtl descriptor
		 *
		 * @param {Object.<string,number>} mtlDescriptor
		 * Lookup containing properties for the MTL to retrieve
		 *
		 * @param {number} mtlDescriptor.seriesId
		 * Series Id of the MTL
		 *
		 * @param {number} mtlDescriptor.seqNum
		 * Sequence Number of the MTL
		 *
		 * @param {number} [mtlDescriptor.segmentIndex = 0]
		 * Segment Index of the MTL
		 *
		 * @return {Promise.<Object>}
		 * Promise that resolves with the Mtl instance
		 */
		getIncomingMtl: function (mtlDescriptor) {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._systemTablesPromise;
				})
				.then(function () {
					return self._db.readRow('SELECT mtl FROM "@incoming" WHERE seriesId = ? AND seqNum = ? AND segmentIndex = ?', [
						mtlDescriptor.seriesId,
						mtlDescriptor.seqNum,
						mtlDescriptor.segmentIndex || 0
					]);
				})
				.then(convertToMtl);

			function convertToMtl(row) {
				var mtl = new Mtl();
				mtl.parse(row.mtl);
				return mtl;
			}
		},
		/**
		 * @method deleteIncomingMtlsNotFromSeries
		 * Deletes all incoming mtls NOT belonging to the given series
		 *
		 * @param {number} seriesId
		 * Series Id of MTLs to keep
		 *
		 * @return {Promise}
		 * Promise that resolves when the operation is complete
		 */
		deleteIncomingMtlsNotFromSeries: function (seriesId) {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._systemTablesPromise;
				})
				.then(function () {
					return self._db.execute('DELETE FROM "@incoming" WHERE seriesId <> ?', [seriesId]);
				});
		},
		/**
		 * @method  getIncomingMtlDescriptors
		 * Retrieves descriptors [{seriesId, seqNum, segmentIndex}] of all of the incoming mtls that belong to the current series.
		 *
		 * @return {Promise.<Array>}
		 * Promise that resolves with the list of descriptors
		 */
		getIncomingMtlDescriptors: function () {
			var self = this;
			return self._openPromise
				.then(function () {
					return self._systemTablesPromise;
				})
				.then(function () {
					return self._db.read('SELECT seriesId, seqNum, segmentIndex FROM "@incoming" WHERE seriesId = ? ORDER BY seqNum, segmentIndex', [self._dsSettings.outSeriesId()]);
				})
				.then(extractMtlDescriptorsFromResultSet);

			function extractMtlDescriptorsFromResultSet(rs) {
				var descriptors = [];
				for (var i = 0; i < rs.rows.length; i++) {
					descriptors.push(rs.rows.item(i));
				}
				return descriptors;
			}
		},
		/**
		 * @method mdoTransaction
		 * Executes and wraps all mdo operations within that callback in a single M-Tier and database transaction.
		 * The callback must return a promise that resolves when all mdo/database operations have completed.
		 *
		 * @param {function(): Promise} callback
		 * Function that performs MDO operations
		 *
		 * @return {Promise}
		 * Promise that resolves when the Transaction is complete
		 *
		 * ## Usage:
		 *      store.mdoTransaction(function() {
			 *			var promises = [];
			 *			_.each(mdoElts, function(mdoElt) {
			 *				promises.push(mdoElt.destroy());
			 *          })
			 *
			 *			return AH.whenAll(promises);
			 *      });
		 *
		 */
		mdoTransaction: function (callback) {
			var self = this;
			if (!_.isFunction(callback)) {
				return AH.reject(new Error("No mdo transaction callback was specified"));
			}

			return self._openPromise
				.then(_.bind(self._throwIfXactInProgress, self))
				.then(executeXact);

			function executeXact() {
				self._isMtlXactInProgress = true;

				var dbXactPromise = self._transaction(function () {
					return self._db.execute([self._mtlXactSqlStatement(self.newMtlBeginXact())])
						.then(callback)
						.then(function () {
							return self._db.execute([self._mtlXactSqlStatement(self.newMtlEndXact())]);
						});
				});

				dbXactPromise.always(function () {
					self._isMtlXactInProgress = false;
				});

				return dbXactPromise;
			}
		},
		/**
		 * @method deployModel
		 * Applies the specified `modelString` to the store
		 *
		 * @param {string} modelString
		 * String representation of the model to deploy. This value should
		 * be calculated by the server.
		 *
		 * @return {Promise}
		 */
		deployModel: function (modelString) {
			var self = this;
			var newModel = Model.fromString(modelString);

			return self._openPromise
				.then(validateNewModel)
				.then(function () {
					return self._deployNewModelToDb(newModel);
				})
				.then(updateModelAndSettings)
				.then(_.bind(self._createSystemTables, self))
				.then(function () {
					self._setModel(newModel);
				});

			function validateNewModel() {
				if (self._dsSettings.modelId() && newModel.modelId !== self._dsSettings.modelId()) {
					return AH.reject(new Error("MDO.datastore.deployModel: datastore[" + self._dsSettings.modelId() + "] != model[" + newModel.modelId + "]"));
				}

				if (self._dsSettings.modelVersion() && Number(newModel.version) < Number(self._dsSettings.modelVersion())) {
					return AH.reject(new Error("New model version (" + newModel.version + ") is less than current model version (" + self._dsSettings.modelVersion() + ")."));
				}
			}

			function updateModelAndSettings() {
				return self._dsSettings.model(modelString)
					.then(function () {
						return self._dsSettings.modelVersion(newModel.version);
					})
					.then(function () {
						if (!self._dsSettings.modelId()) {
							return self._dsSettings.modelId(newModel.modelId);
						}
					});
			}
		},
		getDb: function () { return this._db; },
		/**
		 * @method  _performPartialReset
		 * @private
		 * Delete non-system tables from DB
		 *
		 * @return {Promise}
		 */
		_performPartialReset: function () {
			var self = this;
			return self._db.getTables()
				.then(function (tables) {
					var sqlStatements = [];

					_.each(tables, function (table) {
						if (table.name.charAt(0) === "@") {
							return;
						}

						sqlStatements.push('DROP TABLE "' + table.name + '"');
					});

					if (sqlStatements.length) {
						return self._db.execute(sqlStatements);
					}
				});
		},
		_createSystemTables: function () {
			this._systemTablesPromise = this._createXactTable()
				.then(_.bind(this._createIncomingTable, this))
				.then(_.bind(this._retrieveTempIdCache, this));

			return this._systemTablesPromise;
		},
		/**
		 * @method _createXactTable
		 * @private
		 * Creates transaction table
		 *	id: autogenerated increasing id
		 *	series: inSeriesId
		 *	sequence: inSeqNum
		 *	version: model version
		 *	posted: timestamp when xact was posted (put into outgoing MTC)
		 *	xact: serialized MTL transaction
		 *	ts: timestamp when xact was created
		 *
		 * @return {Promise}
		 */
		_createXactTable: function () {
			var xactTable = 'CREATE TABLE IF NOT EXISTS "@xacts" (id INTEGER PRIMARY KEY ASC, series TEXT NOT NULL, sequence INTEGER NOT NULL, version INTEGER NOT NULL, posted TIMESTAMP, xact TEXT NOT NULL, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)';
			return this._db.execute(xactTable);
		},
		/**
		 * @method _createIncomingTable
		 *
		 * Creates incoming mtl table:
		 *	mtl: the contents of the incoming mtl
		 *	series: the series id that the incoming mtl belongs to
		 *	sequence: the sequence of the incoming mtl
		 *
		 * @return {Promise}
		 */
		_createIncomingTable: function () {
			var self = this;
			return self._db.tableExists("@incoming")
				.then(updateTable);

			function updateTable(tableInfo) {
				var sql = 'CREATE TABLE "@incoming" (mtl NOT NULL, seriesId TEXT NOT NULL COLLATE NOCASE, seqNum INTEGER NOT NULL, segmentIndex INTEGER NOT NULL DEFAULT 0, UNIQUE(seriesId, seqNum, segmentIndex))';
				if (!tableInfo) {
					// Create @incoming table
					return self._db.execute(sql);
				} else if (tableInfo.sql.indexOf("segmentIndex") < 0) {
					return self._db.transaction(function (xact) {
						// Rename existing table
						xact.executeSql('ALTER TABLE "@incoming" RENAME TO "@incoming_temp"');
						// Create @incoming table
						xact.executeSql(sql);
						// Copy data
						xact.executeSql('INSERT INTO "@incoming" (mtl, seriesId, seqNum) SELECT mtl, seriesId, seqNum FROM "@incoming_temp"');
						// Drop original table
						xact.executeSql('DROP TABLE "@incoming_temp"');
					});
				}
			}
		},
		_deployNewModelToDb: function (newModel) {
			var self = this;
			var sqlStatements = [];

			if (self._model) {
				// @todo: worry about collisions on temp table names (or @xacts and @tempid)?

				// model update, look for changes
				var diff = self._model.compareTo(newModel);

				_.each(diff.classesToCreate, function (classId) {
					var modelClass = newModel.classes.getByClassId(classId);
					var sql = modelClass.getSchema();
					logger.log("Creating table '" + modelClass.name + "'");
					sqlStatements.push(sql);
				});

				_.each(diff.classesToDelete, function (classId) {
					var modelClass = self._model.classes.getByClassId(classId);
					logger.log("Dropping table '" + modelClass.name + "'");
					var sql = "DROP TABLE " + modelClass.name;
					sqlStatements.push(sql);
				});

				_.each(diff.classesToAlter, function (classId) {
					var oldModelClass = self._model.classes.getByClassId(classId);
					logger.log("Updating table '" + oldModelClass.name + "'");

					// create temp table with old model's schema
					var tempTableName = '"@' + oldModelClass.name + '"';
					var sql = oldModelClass.getSchema(tempTableName);
					sqlStatements.push(sql);

					var copySql = "INSERT INTO " + tempTableName + " SELECT * FROM " + oldModelClass.name;
					sqlStatements.push(copySql);

					// drop existing table
					sql = "DROP TABLE " + oldModelClass.name;
					sqlStatements.push(sql);

					// recreate existing table with new schema
					var newModelClass = newModel.classes.getByClassId(classId);
					sql = newModelClass.getSchema();
					sqlStatements.push(sql);

					// copy data from temp table into new table
					var commonFieldIds = _.intersection(_.pluck(newModelClass.fields, "fieldId"), _.pluck(oldModelClass.fields, "fieldId"));
					if (commonFieldIds && commonFieldIds.length) {
						var sourceColumns = _.map(commonFieldIds, function (fieldId) {
							return oldModelClass.fields.getByFieldId(fieldId).name;
						}).join(", ");

						var destinationColumns = _.map(commonFieldIds, function (fieldId) {
							return newModelClass.fields.getByFieldId(fieldId).name;
						}).join(", ");

						copySql = "INSERT INTO " + newModelClass.name + "(" + destinationColumns + ") SELECT " + sourceColumns + " FROM " + tempTableName;
						sqlStatements.push(copySql);
					}
					// drop temp table
					sql = "DROP TABLE " + tempTableName;
					sqlStatements.push(sql);
				});

			} else {

				// installation, just create all the classes in newModel
				for (var i = 0; i < newModel.classes.length; i++) {
					sqlStatements.push(newModel.classes[i].getSchema());
				}
			}

			if (sqlStatements.length) {
				return self._db.execute(sqlStatements);
			}
		},
		/**
		 * @method  _buildSqlAssignmentArray
		 * @private
		 * Appends `attrs` values to optional `args` array.
		 *
		 * @return {Array.<string>}
		 * Array of "key=?" string based on the `attrs` keys.
		 */
		_buildSqlAssignmentArray: function (attrs, args) {
			args = args || [];
			var assignment = [];
			_.keys(attrs).forEach(function (key) {
				assignment.push(key + "=?");
				args.push(attrs[key]);
			});
			return assignment;
		},
		/**
		 * @method extractRowsFromResultSet
		 * @private
		 *
		 * @param {Object} rs
		 * WebSql result set
		 *
		 * @return {Array.<Object>}
		 * Rows in a given result set
		 */
		_extractRowsFromResultSet: function (rs) {
			var rows = [];
			for (var i = 0; i < rs.rows.length; i++) {
				rows.push(rs.rows.item(i));
			}
			return rows;
		},
		/**
		 * @method _mtlXactSqlStatement
		 * @private
		 *
		 * @param {Object} mtlXact
		 * MTL Transaction
		 *
		 * @return {Object.<string,string|number>}
		 * Lookup representing a SQL Statement
		 *
		 * @return {string} return.sql
		 * Parameterized SQL statement
		 *
		 * @return {Array.<string|number>} return.args
		 * Arguments for the Parameterized SQL statement
		 */
		_mtlXactSqlStatement: function (mtlXact) {
			return {
				sql: 'INSERT INTO "@xacts" (series, sequence, version, xact) VALUES (?, ?, ?, ?)',
				args: [this._dsSettings.inSeriesId(), this._dsSettings.inSeqNum(), this._model.version, JSON.stringify(mtlXact)]
			};
		},
		/**
		 * @method _mtlXactStatementBlock
		 * @private
		 * If necessary, sourrounds `statements` with SQL statements for MTL begin/end xacts
		 *
		 * @param {Array.<string>} statements
		 * String array of SQL Statements
		 *
		 * @return {Array.<string>}
		 * Array of updated statements
		 */
		_mtlXactStatementBlock: function (statements) {
			// Each datstore statement has a corresponding MTL xact statement
			if (statements.length > 2 && !this._isMtlXactInProgress) {
				// Wrap in MTL transaction block
				statements.unshift(this._mtlXactSqlStatement(this.newMtlBeginXact()));
				statements.push(this._mtlXactSqlStatement(this.newMtlEndXact()));
			}
			return statements;
		},
		/**
		 * @method _newMtlUpsertXact
		 * @private
		 * Gets an MTL `xactType` ('C' or 'U') transaction for `values` in a `modelClass` element
		 * identified by `id`
		 *
		 * @param {string} xactType
		 * Transaction type. Either 'C' for create or 'U' for update.
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass to upsert a row for
		 *
		 * @param {number} id
		 * ID of the row to Upsert
		 *
		 * @param {Object.<string,string|number>} values
		 * Lookup of field values for the transaction
		 *
		 * @param {boolean} localOnly
		 * If true, transaction will be local only
		 *
		 * @return {Object.<string,string|Object>}
		 * An MTL Transaction
		 *
		 * @return {string} return.t
		 * MTL xactType
		 *
		 * @return {Object.<string, number>} return.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @return {number} return.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @return {number} return.set.5
		 * the MTL's 'in' Sequence Number
		 */
		_newMtlUpsertXact: function (xactType, modelClass, id, values, localOnly) {
			var keys = _.keys(values);
			// Remove local-only fields
			if (localOnly) {
				keys = _.difference(keys, localOnly);
			}
			// Bail if nothing's left to update
			if (xactType !== Mtl.xactType.Create && _.isEmpty(keys)) {
				return null;
			}

			var mtlXact = this._newMtlDataXact(xactType, modelClass, id, localOnly);

			// Lazily created set ftmp objectes
			var set, ftmp;
			_.forEach(keys, function (key) {
				var field = modelClass.fields.getByName(key);
				var value = Store.dbToMtlValue(field, values[key]);
				if (field.element && !_.isNull(value)) {
					// Ensure key values are numeric
					value = Number(value);
				}

				if (field.element && value < 0) {
					ftmp = (ftmp || (mtlXact[MtlIdPurpose.foreignTempId] = {}));
					ftmp[field.fieldId] = value;
				} else {
					set = (set || (mtlXact.set = {}));
					set[field.fieldId] = value;
				}

			});

			return mtlXact;
		},
		/**
		 * @method _newMtlDataXact
		 * @private
		 * Creates an empty MTL xact of specified `xactType`, `modelClass` and `id`
		 *
		 * @param {string} xactType
		 * Transaction Type
		 *
		 * @param {DataModel.Class} modelClass
		 * ModelClass for the Transaction's row
		 *
		 * @param {number} id
		 * ID of the row to create a transaction for
		 *
		 * @param {boolean} [localOnly=false]
		 * A true value indicates that this transaction should not be sent to the server
		 *
		 * @return {Object.<string,string|Object>}
		 * An MTL Transaction
		 *
		 * @return {string} return.t
		 * MTL xactType
		 *
		 * @return {Object.<string, number>} return.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @return {number} return.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @return {number} return.set.5
		 * the MTL's 'in' Sequence Number
		 */
		_newMtlDataXact: function (xactType, modelClass, id, localOnly) {
			// Create transaction
			var mtlXact = {
				t: xactType,
				classId: modelClass.classId
			};

			// Test strict equality, since localOnly can also be an array of field names
			if (localOnly === true) {
				mtlXact.localOnly = true;
			}

			// Ensure id is numeric
			id = Number(id);

			var key = {};
			key[modelClass.idField.fieldId] = id;
			// Determine whether ID is permanent (> 0), primary temp (base class) or both temp (derived class)
			var keyPurpose = MtlIdPurpose.permanentId;
			if (id < 0) {
				keyPurpose = modelClass.baseClass ? MtlIdPurpose.bothTempId : MtlIdPurpose.primaryTempId;
			}
			mtlXact[keyPurpose] = key;

			return mtlXact;
		},
		/**
		 * @method _readRow
		 * @private
		 * Executes a read statement as part of the current transaction, or as a standalone statement
		 * if no transaction is in progress
		 *
		 * @param {string} sql
		 * SQL Select statement
		 *
		 * @param {Array.<string|number>} args
		 * Arguments for the Sql Select Statement
		 *
		 * @return {Promise.<Row>}
		 * Resolves with the single row in the result set.
		 * Rrejects if more than one, or no rows exist.
		 */
		_readRow: function (sql, args) {
			return this._db.read(sql, args)
				.then(function (rs) {
					if (rs.rows.length !== 1) {
						throw new Error("Query returned " + rs.rows.length + " rows");
					} else {
						return rs.rows.item(0);
					}
				});
		},
		/**
		 * @method _throwIfXactInProgress
		 * @private
		 * Throws an error if a transaction is currently in progress
		 *
		 * @throws {Error}
		 * "A transaction is already in progress"
		 */
		_throwIfXactInProgress: function () {
			if (this._isMtlXactInProgress) {
				throw new Error("A transaction is already in progress");
			}
		},
		/**
		 * @method transaction
		 *
		 * Executes and wraps all database and vault operations within that callback in a single transaction.
		 * The callback must return a promise that resolves when all database operations have completed.
		 * Checks that the store is open before starting the transaction.
		 *
		 * @param {function(): Promise} callback
		 * Function that performs database and vault operations operations
		 *
		 * @return {Promise}
		 * Promise that resolves when the Transaction is complete
		 *
		 * ## Usage:
		 *      store.transaction(function() {
			 *			var promises = [];
			 *			_.each(mdoElts, function(mdoElt) {
			 *				promises.push(mdoElt.destroy());
			 *          })
			 *
			 *			return AH.whenAll(promises);
			 *      });
		 *
		 */
		transaction: function (callback) {
			return this._openPromise
				.then(_.bind(this._transaction, this, callback));
		},
		/**
		 * @method _importIncomingMtlsFromFs
		 *
		 * Imports all of the mtls from the datastore's incoming filesystem folder into the datastore repository
		 * Checks that the store is open before importing the MTLs.
		 *
		 * @return {Promise}
		 * Promise that resolves when all incoming mtls have been imported
		 */
		importIncomingMtlsFromFs: function () {
			return this._openPromise
				.then(_.bind(this._importIncomingMtlsFromFs, this));
		},
		/**
		 * @method addIncomingMtl
		 * Adds an mtl (Mtl instance of json mtl) to the collection of incoming mtls for this datastore
		 * Checks that the store is open before adding the MTL.
		 *
		 * @param {Object.<string,string|Object>} mtl
		 * An MTL Transaction
		 *
		 * @param {string} mtl.t
		 * MTL xactType
		 *
		 * @param {Object.<string, number>} mtl.set
		 * MTL Data defining the set that the MTL belongs to
		 *
		 * @param {number} mtl.set.4
		 * the MTL's 'in' Series ID
		 *
		 * @param {number} mtl.set.5
		 * the MTL's 'in' Sequence Number
		 *
		 * @return {Promise}
		 * Promise that resolves when the mtl has been added successfully
		 */
		addIncomingMtl: function (mtl) {
			return this._openPromise
				.then(_.bind(this._addIncomingMtl, this, mtl));
		}
	}, {
		// tValueIDs enum in \src\common\libraries\ahlMTL\ahMTLTypes.h
		MtlValueIds: {
			inSeriesID: "4",
			inSequenceNum: "5",
			outSeriesID: "6",
			outSeqNum: "7"
		}
	});

	return Store;

});
define('Data/Server',[
	"AH",
	"MDO/Stats",
	"underscore",
	"./Store",
	"lib/Class",
	"Constants"
], function (
	AH,
	Stats,
	_,
	Store,
	Class,
	Constants
	) {

	"use strict";

	// Total number of server queries executed
	var queryCount = 0;

	/**
	 * @class Data.Server
	 * Exposes access to server side data in the form of rows.
     *
	 * @private
	 */
	var Server = Class.extend({
		/**
		 * @constructor
		 * Creates a new Server instance
		 *
		 * @param {Data.Store} store
		 * Store used to access model and datastore information.
		 *
		 * @param {Http.Server} httpServer
		 * Server used to make query requests.
		 *
		 */
		constructor: function (store, httpServer) {
			this._store = store;
			this._httpServer = httpServer;
		},
		/**
		 * @method getRow
		 * @async
		 *
		 * Retrieves a single row from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictating how to retrieve the row
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array} [config.filterParams]
		 * values used to complete parameterized filter
		 *
		 * @param {Object} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string} [config.queryOptions.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Row>}
		 * Resolves with the retrieved row. Rejects if more than one, or no rows exist
		 */
		getRow: function (config) {

			return this.getRows(config)
				.then(extractSingleRow);

			function extractSingleRow(results) {
				if (results.length === 1) {
					return results[0];
				}

				var error = new Error(results.length + " rows matched for '" + config.className + "' WHERE " + JSON.stringify(config.filter));
				error.mdoCode = results.length < 1
					? Constants.errorCodes.dataNotFound
					: Constants.errorCodes.dataNotUnique;
				return AH.reject(error);
			}
		},
		/**
		 * @method getRows
		 * @async
		 *
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictating how to retrieve the rows
		 *
		 * @param {number} [config.timeout=120000]
		 * Duration, in milliseconds, for the Server to wait before the request is considered to have timed-out.
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object.<string,string|number>} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [config.filterParams]
		 * values used to complete parameterized filter
		 *
		 * @param {Object.<string,string|number|Array>} [config.queryOptions]
		 * additional options to apply to the query
		 *
		 * @param {string|Object.<string,string|number>} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [config.filterParams]
		 * values used to complete parameterized filter
		 *
		 * @param {boolean} [config.totalCount=false]
		 * Set the `totalCount` property of returned `rows`.
		 *
		 * @param {string} [config.queryOptions.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryOptions.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryOptions.offset]
		 * Offset of the first row to return.
		 *
		 * @param {Array.<string>} [config.queryOptions.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		getRows: function (config) {
			var self = this;
			return self._store.open().then(function () {
				var modelClass = self._store.getModelClass(config.className);
				var parsedFilter = Store.parseFilter(config.filter, config.filterParams, modelClass, true);
				var request = {
					dataStoreId: self._store.dataStoreInfo.id(),
					className: config.className,
					queryOptions: _.extend({}, config.queryOptions, parsedFilter, {
						getRows: true,
						getCount: config.totalCount
					})
				};

				queryCount++;

				return self._httpServer.query(request, config.timeout)
					.then(deserializeResults);


				function deserializeResults(rs) {
					var results = [];
					var row, result;
					for (var i = 0; i < rs.rows.length; i++) {
						row = rs.rows[i];
						result = {};
						_.keys(row).forEach(deserialize);
						results.push(result);
					}

					if (!_.isUndefined(rs.count)) {
						results.totalCount = rs.count;
					}

					Stats.updateStat("READ-SERVER", config.className, results.length);
					return results;

					function deserialize(key) {
						var field = modelClass.allFields.getByName(key);
						result[key] = field.valueFromDb(Store.mtlToDbValue(field, row[key]));
					}
				}
			});
		},

		/**
		 * @method getCount
		 * @async
		 *
		 * Get the number of Rows matching the given filter.
		 *
		 * @param {Object} config
		 * Parameters dictating how to retrieve the rows
		 *
		 * @param {number} [config.timeout=120000]
		 * Duration, in milliseconds, for the Server to wait before the request is considered to have timed-out.
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object.<string,string|number>|MDO.Element} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {Array.<string|number>} [config.filterParams]
		 * values used to complete parameterized filter
		 *
		 * @return {Promise.<number>}
		 * a promise that resolves with the count of 'className' records that match 'filter'
		 */
		getCount: function (config) {
			var self = this;
			return self._store.open()
				.then(function () {
					var modelClass = self._store.getModelClass(config.className);
					var parsedFilter = Store.parseFilter(config.filter, config.filterParams, modelClass, true);
					var request = {
						dataStoreId: self._store.dataStoreInfo.id(),
						className: config.className,
						queryOptions: _.extend({}, config.queryOptions, parsedFilter, { getCount: true })
					};

					queryCount++;

					return self._httpServer.query(request, config.timeout)
						.then(deserializeResults);

					function deserializeResults(rs) {
						var count = rs.count;
						Stats.updateStat("READ-SERVER", config.className, 1);
						return count;
					}
				});
		},

		/**
		 * @method session
		 *
		 * Executes a callback within an authenticated {@link Http.Server#session}.
		 *
		 * @param {Function} callback
		 * Takes an Http.Server, the authentication response, executes actions on the server, and
		 * returns a promise
		 *
		 * @param {number} [authTimeout=30000]
		 * Duration in milliseconds to wait before Server considers the authentication or disconnect request to have
         * timed out.
		 *
		 * @return {Promise}
		 * Settles with the same error or value as the callback's returned promise.
		 */
		session: function(callback, authTimeout) {
			return this._httpServer.session(callback, authTimeout);
		}

	}, {
		/**
		 * @method queryCount
		 *
		 * Returns the total number of queries executed against all servers
		 *
		 * @returns {number}
		 */
		queryCount: function() {
			return queryCount;
		}
	});

	return Server;
});
// MDO/Datastore
//
// This class represents an M-Tier Datastore instance owned by the domain
//
// It persists its settings using the `LocalStorage/Datastore` class.
// It manages its database using the `Data/Store` class.
//
// ## Instance methods and properties:
//
//	* `destroy()`: Deletes database and files by data store (but not domainInfo!)
//	* `open()`: Opens the datastore database and loads the model from disk
//	* `close()`: Closes the database and discards model
//	* `isOpen()': Returns `true` if currently open
//	* `deployModel(modelPath)': Updates the schema with `modelPath` `Data/Model` file and copies model into datastore directory.
//	* `processDataSyncs()`: Apply data MTL files to the data store
//	* `validateClassName(className)`: Throws an exception unless `className` represents a valid model class
//
//	* dsInfo: The `LocalStorage/Datastore` settings for this datastore
//	* store: The `Data/Store` current Data/Store or null
//	* model: The `Model/DataModel` current DataModel or null
//
define('MDO/Datastore',[
	"AH",
	"underscore",
	"./AsyncEvents",
	"Files/fs",
	"Logging/logger",
	"Files/Mtl",
	"Files/Mtc",
	"DataModel/Model",
	"Data/Store",
	"Data/Server",
	"Constants",
	"Messages/Message"
], function (
	AH,
	_,
	AsyncEvents,
	fs,
	logger,
	Mtl,
	Mtc,
	Model,
	Store,
	Server,
	Constants,
	Message
	) {

	"use strict";

	var exports;

	/**
	 * @class MDO.DataStore
	 * @private
	 *
	 * Class representing access to the data store.
	 *
	 * ## Usage:
	 *
	 *		var dsInfo = ...;  // LocalStorage.Datastore instance
	 *		var datastore = new Datastore(dsInfo);
	 *		datastore.open().then(...);
	 */


	/**
	 * @constructor
	 *
	 * @param {LocalStorage.DataStore} dsInfo
	 * Contains the necessary info, such as the datastore's id, to construct the datastore.
	 *
	 * @param {Http.Server} httpServer
	 * Server to make remote requests against.
	 */
	return function (dsInfo, httpServer) {
		var store = new Store(dsInfo);
		var server = new Server(store, httpServer);
		var closedRejectedPromise = AH.reject(new Error("Datastore is closed"));
		var openPromise = closedRejectedPromise;
		var isOpen = false;

		/**
		 * @method destroy
		 *
		 * Deletes the database, files and registry settings for this datastore
		 *
		 * @return {Promise}
		 * Resolves when the destruction of the Datastore is complete.
		 */
		function destroy() {
			return openPromise
				.always(function () {
					var promises = [];

					promises.push(fs.deleteDirectory(dsInfo.directory())
						.then(null, function () {
							return AH.resolve();
						}));

					promises.push(store.destroy());

					return AH.whenAll(promises);
				});
		}

		/**
		 * @method open
		 * Open the datastore database
		 *
		 * @return {Promise}
		 * Resolves when the database is open
		 */
		function open() {
			if (openPromise !== closedRejectedPromise) {
				return openPromise;
			}

			openPromise = store.open();

			openPromise
				.then(function () {
					isOpen = true;
				}, close);

			return openPromise;
		}

		/**
		 * @method close
		 * Closes the datastore
		 *
		 * @return {Promise.<MDO.DataStore>}
		 */
		function close() {
			var self = this;
			openPromise = closedRejectedPromise;
			isOpen = false;
			return closeStore().then(function () {
				return AH.resolve(self);
			});
			function closeStore() {
				return store.close();
			}
		}

		/**
		 * @method deployModel
		 * Deploys the model file at the specified path to the datastore
		 *
		 * Database schema will be updated to reflect the new model
		 * The model file will be stored in `/domain_name/DataStores/datastore_id/datastore_id.mdm`
		 *
		 * @param {string} modelString
		 * String representation of the model to deploy. This value should
		 * be calculated by the server.
		 *
		 * @return {Promise}
		 * Resolves when the model has been deployed.
		 */
		function deployModel(modelString) {
			return openPromise
				.then(deployNewModel);

			function deployNewModel() {
				return store.deployModel(modelString);
			}
		}

		/**
		 * @method throwIfClosed
		 * @private
		 * Throws an exception if the datastore is not open.
		 *
		 * @throws {Error}
		 * 'Datastore is closed'
		 */
		function throwIfClosed() {
			if (!isOpen) {
				throw new Error("Datastore is closed");
			}
		}

		/**
		 * @method validateClassName
		 * Throws an exception unless `className` represents a valid model class
		 *
		 * @throws {Error}
		 * 'Model not deployed'
		 *
		 * @throws {Error}
		 * 'Invalid class name: %s'
		 */
		function validateClassName(className) {
			if (!this.model) {
				throw new Error("Model not deployed");
			}
			if (!this.model.classes.getByName(className)) {
				throw new Error("Invalid class name: " + className);
			}
			return true;
		}

		/**
		 * @method processDataSyncs
		 * Apply data MTL transaction to the DataStore from the following locations:
		 *
		 *		1. {DatastoreId}\Incoming
		 *
		 * @param {boolean} hasDataRepost
		 * True if the Datastore should treat the process as an installation or data repost.
		 *
		 * @return {Promise}
		 * Resolves when data synchronizations have been processed.
		 */
		function processDataSyncs(hasDataRepost) {

			var resolvedTempIds, processedXacts;

			return openPromise
				.then(getResolvedTempIds)
				.then(processIncoming)
				.then(reapplyPosted)
				.then(reapplyOutgoing)
				.then(function() {
					return processedXacts && exports.asyncTrigger("processedXacts");
				});

			// Fetch previously resolved temp IDs
			function getResolvedTempIds() {
				return store.getTempIdCache();
			}

			// Process MTLs from server
			function processIncoming(cache) {
				resolvedTempIds = cache;
				return processIncomingMtls(resolvedTempIds, hasDataRepost)
					.then(function(hasXacts) {
						processedXacts = hasXacts;
					});
			}

			// Reapply MTL xacts sent to server
			function reapplyPosted() {
				return store.getAllPostedMtlXactRecords()
					.then(reapplyMtlXacts);
			}

			// Reapply MTL xacts that have not been sent to the server
			function reapplyOutgoing() {
				return store.getOutgoingMtlXactRecords()
					.then(reapplyMtlXacts);
			}

			function reapplyMtlXacts(records) {
				var mtlXacts = prepareMtlXactsForReapplication(records, resolvedTempIds, hasDataRepost);
				var mtl = new Mtl();
				mtl.insertXacts(mtlXacts, 0);
				return store.applyMtlXacts(mtl);
			}
		}

		// ### processIncomingMtls(resolvedTempIds)
		//
		// Returns a promise that resolves with boolean indicating whether
		// any transactions were processed.
		//
		function processIncomingMtls(resolvedTempIds, hasDataRepost) {
			return store.getIncomingMtlDescriptors()
				.then(raiseEvent)
				.then(applyMtls);

			function raiseEvent(descriptors) {
				if (descriptors.length > 0) {
					return exports.asyncTrigger("processingXacts")
						.then(function() {
							return descriptors;
						});
				}

				return descriptors;
			}

			function applyMtls(descriptors) {
				var mtlGroups = _.groupBy(descriptors, "seqNum");
				var promise = AH.resolve();
				// Initialize progress stats
				var stats = {
					count: 0,
					total: _.reduce(_.values(mtlGroups), function(count, mtlGroup) {
						return count + mtlGroup.length;
					}, 0)
				};

				var seqNums = _.keys(mtlGroups);

				// Iterate over MTL (segments) in numerical order of seqNum
				seqNums.sort(function(a, b) { return a - b; });

				_.forEach(seqNums, function (seqNum) {
					var mtlGroup = mtlGroups[seqNum];
					promise = promise.then(function () {
						var p = applyIncomingMtlGroup(mtlGroup, resolvedTempIds, stats, hasDataRepost);
						return p;
					});
				});

				return promise.then(function() {
					return descriptors.length > 0;
				});
			}
		}

		function getModel() {
			throwIfClosed();

			return store.model;
		}

		/**
		 * @method applyIncomingMtlGroup
		 * @private
		 *
		 * Applies an incoming (segmented) MTL to the data store.
		 *
		 * @param {Object[]} descriptors
		 *
		 * List of 1 or more MTL segments
		 *
		 * @param {Object} resolvedTempIds
		 *
		 * Map of tempId to permanentId
		 *
		 * @param {Object} stats
		 *
		 * Progress statistics
		 *
		 * @param {Number} stats.count
		 *
		 * Number of segments processed so far
		 *
		 * @param {Number} stats.total
		 *
		 * Total number of segments to be processed
		 *
		 * @param {boolean} hasDataRepost
		 *
		 *  Indicates whether a data repost has been processed
		 *
		 * @returns {Promise}
		 */
		function applyIncomingMtlGroup(descriptors, resolvedTempIds, stats, hasDataRepost) {
			return openPromise.then(function () {
				var model = getModel();
				var settings = store.settings;

				var nextSeqNum = settings.outSeqNum();
				var syncedInSeqNum;

				stats = stats || { count: 0, total: descriptors.length };

				var promise = _.reduce(descriptors, function (p, descriptor) {
					var mtl;

					return p.then(function () {
						stats.count += 1;
						logMessage("Applying server change '" + descriptor.seriesId + "." + descriptor.seqNum + ".MTL' [" + descriptor.segmentIndex + "]...");
						return AH.notify(Message.getMessage(Constants.messageCodes.applyingServerChanges, stats.count, stats.total), applyMtl());
					});

					function applyMtl() {
						return getMtl()
							.then(prepareMtlXacts)
							.then(applyMtlXacts)
							.then(deleteMtl);
					}

					function getMtl() {
						return store.getIncomingMtl(descriptor)
							.then(function (incomingMtl) {
								if (incomingMtl.seriesId !== settings.outSeriesId()) {
									return AH.reject(new Error("MTL series '" + incomingMtl.seriesId + "' does not match OutSeriesId '" + settings.outSeriesId() + "'"));
								}
								if (incomingMtl.seqNum < settings.outSeqNum()) {
									mtl = incomingMtl;
									logMessage("Skipping server change '" + descriptor.seriesId + "." + descriptor.seqNum + ".MTL' [" + descriptor.segmentIndex + "] because it has already been applied");
									return null; // Flag to skip this mtl
								} else if (incomingMtl.seqNum !== settings.outSeqNum()) {
									return AH.reject(new Error("MTL sequence '" + incomingMtl.seqNum + "' does not match OutSeqNum '" + settings.outSeqNum() + "'"));
								}
								if (incomingMtl.modelVersion > model.version) {
									return AH.reject(new Error("MTL model version (" + incomingMtl.modelVersion + ") is greater than the deployed model version (" + model.version + ")"));
								}
								return (mtl = incomingMtl);
							});
					}

					function deleteMtl() {
						return store.deleteIncomingMtl(mtl);
					}

				}, AH.resolve());

				promise = promise.then(updateNextSeqNum);

				return promise;

				// ### applyMtlXacts(mtl)
				//
				// Applies xacts in mtl (which at this point contains incoming and posted xacts)
				//
				function applyMtlXacts(mtl) {
					if (!mtl) {
						return AH.resolve();
					}
					return store.applyMtlXacts(mtl);
				}

				// #### Process datastore settings transactions
				//
				// E.g. OutSeqNum
				//
				function processDatastoreSettings(mtlXact) {
					_.keys(mtlXact.set || {}).forEach(function (key) {
						var value = mtlXact.set[key];
						switch (key) {
							case Store.MtlValueIds.outSeqNum:
								nextSeqNum = value;
								break;
							default:
								throw new Error("Unexpected MTL Datastore Setting: " + key + "=" + value);
						}
					});
				}

				// prepareMtlXacts(mtl)
				//
				// Prepare incoming MTL for application to data store:
				//
				//		* Append corresponding posted mtlXacts to SYNC transactions
				//		* Delete DS transaction and apply its settings to datastore
				//		* Add resolved temp IDs to `resolvedTempIds`
				//		* Delete C,U,D, and I transactions against dropped model classes
				//		* Prune 'set' values against dropped model fields for C, CV and U transactions
				//		* Delete U transactions that have no 'set' values after pruning
				//
				// Returns a promise that resolves with the prepared mtl.
				//
				function prepareMtlXacts(mtl) {
					// don't do anything if the MTL was ignored
					if (!mtl) {
						return AH.resolve();
					}
					// Assuming we will not see a DS setting that rolls the nextSeqNum back, only forwards (when MTLs are grouped)
					if (nextSeqNum < mtl.seqNum + 1) {
						nextSeqNum = mtl.seqNum + 1;
					}

					var idx = 0;
					var mtlXact, modelClass;
					// Number of posted xacts that have been inserted into MTL
					var numPostedXacts = 0;

					var postedPromise = null;

					while ((mtlXact = mtl.getXact(idx++))) {
						modelClass = model.classes.getByClassId(mtlXact.classId);
						if (mtlXact.classId && !modelClass) {
							// xact specifies a class and it does not exist anymore
							idx -= 1;
							mtl.deleteXact(idx);
						} else {
							switch (mtlXact.t) {
								case Mtl.xactType.Sync:
									syncedInSeqNum = mtlXact.set[Store.MtlValueIds.inSequenceNum];
									insertPosted(syncedInSeqNum, idx - 1);
									break;
								case Mtl.xactType.Setting:
									processDatastoreSettings(mtlXact);
									// Delete it from MTL
									idx -= 1;
									mtl.deleteXact(idx);
									break;
								case Mtl.xactType.Identity:
									addResolvedTempIdToCache();
									break;
								case Mtl.xactType.Create:
								case Mtl.xactType.CreateValidate:
									pruneDroppedColumns(mtlXact, modelClass);
									break;
								case Mtl.xactType.Update:
									pruneDroppedColumns(mtlXact, modelClass);
									if (_.isEmpty(mtlXact.set)) {
										// xact only updates dropped field(s)
										idx -= 1;
										mtl.deleteXact(idx);
									}
									break;
								default:
									break;
							}
						}
					}

					function addResolvedTempIdToCache() {

						var xactModelClass;
						if ((xactModelClass = model.classes.getByClassId(mtlXact.classId))) {

							var fieldId = xactModelClass.idField.fieldId,
								tempId = mtlXact.id[fieldId],
								permId = mtlXact.set[fieldId];

							postedPromise = AH.when(postedPromise, function () {
								resolvedTempIds[tempId] = permId;
							});
						}
					}

					function insertPosted(seqNum, syncXactIndex) {
						postedPromise = AH.when(postedPromise, function () {
							return store.getPostedMtlXactRecordsInSequence(seqNum).then(function (records) {
								// Convert @xact records into mtlXacts
								var mtlXacts = prepareMtlXactsForReapplication(records, resolvedTempIds, hasDataRepost);

								// Adjust index by previously inserted posted xacts
								syncXactIndex += numPostedXacts;

								// Append posted mtlXacts to SYNC transaction
								mtl.insertXacts(mtlXacts, syncXactIndex);
								numPostedXacts += mtlXacts.length;
							});
						});
					}

					return AH.when(postedPromise, function () {
						return mtl;
					});
				}

				// #### updateNextSeqNum()
				//
				// Store the nextSeqNum in the registry.
				//
				function updateNextSeqNum() {
					return settings.outSeqNum(nextSeqNum);
				}
			});
		}

		/**
		 * @method pruneDroppedColumns
		 * @private
		 * Checks the field id's in the transaction's set against the
		 * existing fields in the modelClass. If the fields do not
		 * exist in the modelClass, they are pruned from the xact.
		 *
		 * @param {Object} xact
		 * MTL transaction
		 *
		 * @param {DataModel.Class} modelClass
		 */
		function pruneDroppedColumns(xact, modelClass) {
			_.each(_.keys(xact.set || {}), function (fieldId) {
				if (!modelClass.fields.getByFieldId(fieldId)) {
					delete xact.set[fieldId];
				}
			});
		}

		/**
		 * @method prepareMtlXactsForReapplication
		 * @private
		 * Convert the xacts records into an array of mtlXacts.
		 *
		 * @param {Object[]} records
		 * Array of objects containing a representation of an mtlXact.
		 * Each object should have a 'xact' property .
		 *
		 * @param {Number[]} resolvedTempIds
		 * Lookup containing tempIds that have been resolved mapped to their permanent values
		 *
		 * @param {boolean} hasDataRepost
		 * True if the Datastore should treat the preparation as an installation or data repost.
		 *
		 * @return {Array}
		 * Array of objects representing MTL transactions
		 */
		function prepareMtlXactsForReapplication(records, resolvedTempIds, hasDataRepost) {
			/* eslint-disable id-length, complexity */
			var mtlXacts = [];
			records.forEach(function (record) {
				var postedMtlXact = JSON.parse(record.xact);

				// Skip localOnly Xacts after DataRepost
				if (hasDataRepost && postedMtlXact.localOnly) {
					return;
				}

				// Resolve TempIds
				switch (postedMtlXact.t) {
					case Mtl.xactType.Sync:
					case Mtl.xactType.Identity:
						// Skip while reapplying
						return;
					case Mtl.xactType.Create:
						// Convert to LocalCreate
						postedMtlXact.t = Mtl.xactType.LocalCreate;
						// Fall through!
					case Mtl.xactType.Update:
					case Mtl.xactType.Delete:
						var modelClass = exports.model.classes.getByClassId(postedMtlXact.classId);
						if (!modelClass) {
							// Skip transactions whose model class no longer exists
							return;
						}
						// Resolve Primary and Both tempIds into `id`
						if (postedMtlXact.ptmp || postedMtlXact.btmp) {
							postedMtlXact.id = postedMtlXact.id || {};
							resolveTempIds(_.extend({}, postedMtlXact.ptmp, postedMtlXact.btmp), postedMtlXact.id);
						}
						// Resolve Foreign tempIds into `set`
						if (postedMtlXact.ftmp) {
							postedMtlXact.set = postedMtlXact.set || {};
							resolveTempIds(postedMtlXact.ftmp, postedMtlXact.set);
						}

						// Update 'set' to exclude fields that no longer exist
						if (postedMtlXact.set) {
							pruneDroppedColumns(postedMtlXact, modelClass);
						}

						// Exclude transaction that were created solely with fields that no longer exist
						if (postedMtlXact.t === Mtl.xactType.Update && _.isEmpty(postedMtlXact.set)) {
							return;
						}

						// When not doing a data repost, exclude CREATE transaction that still have an unresolved TempID
						if (!hasDataRepost && postedMtlXact.t === Mtl.xactType.LocalCreate
							&& postedMtlXact.id[modelClass.idField.fieldId] < 0) {
							return;
						}

						break;
					case Mtl.xactType.Begin:
					case Mtl.xactType.End:
						// do nothing
						return;
					default:
						console.log("insertPosted: UNEXPECTED " + JSON.stringify(postedMtlXact));
						return;
				}

				mtlXacts.push(postedMtlXact);

				// Replace resolved temp IDs with permanent IDs

				function resolveTempIds(source, target) {
					_.keys(source).forEach(function (fieldId) {
						var tempid = source[fieldId];
						target[fieldId] = resolvedTempIds[tempid] || tempid;
					});
				}
			});

			return mtlXacts;
			/* eslint-enable id-length, complexity */
		}

		/**
		 * @method prepareOutgoingMtls
		 * @private
		 * Convert transactions in xacts table into an array of MTL objects
		 *
		 * @return {Promise.<Array>}
		 * Resolves with an array of the prepared {@link Files.Mtl MTLs}
		 */
		function prepareOutgoingMtls() {

			return openPromise
				.then(function () {
					return store.getOutgoingMtlXactRecords();
				})
				.then(buildMtls);

			function buildMtls(records) {
				var mtls = [];
				var mtl;

				records.forEach(function (record) {
					// Start new MTL, if necessary
					if (!mtl || mtl.seqNum !== record.sequence) {
						mtl = new Mtl();
						mtl.modelId = store.settings.modelId();
						mtl.modelVersion = record.version;
						mtl.seriesId = record.series;
						mtl.seqNum = record.sequence;
						mtls.push(mtl);

						// Start with Sync transaction
						mtl.addXact(store.newMtlSyncXact(record.sequence));
					}

					// Add transaction
					var xact = JSON.parse(record.xact);
					if (!xact.localOnly) {
						mtl.addXact(xact);
					}
				});

				return mtls;
			}
		}

		/**
		 * @method prepareOutgoingMtcs
		 * Combines outgoing MTLs into outgoing domain MTCs.
		 *
		 * @param {string} destinationDir
		 * destination for the MTCs
		 *
		 * @return {Promise}
		 * Resolves when the outgoing MTCs have been prepared.
		 */
		function prepareOutgoingMtcs(destinationDir) {

			return openPromise
				.then(prepareOutgoingMtls)
				.then(convertMtlsToMtcs);

			// Pack datastore outgoing MTLs into domain outgoing MTCs

			function convertMtlsToMtcs(mtls) {
				if (mtls.length === 0) {
					return undefined;
				}

				// Add MTLs to MTC
				var promise = mtls.reduce(function (previous, mtl) {

					return AH.when(previous)
						.then(convertToMtc)
						.then(moveXactsToPosted)
						.then(updateSeqNum);

					function convertToMtc() {
						var dataSyncMtc = new Mtc();
						dataSyncMtc.fileName = mtl.seriesId + "." + mtl.seqNum + ".mtc";
						dataSyncMtc.type = "DataSync";
						dataSyncMtc.version = mtl.seqNum;
						dataSyncMtc.contentId = mtl.seriesId;
						dataSyncMtc.destinationId = store.settings.id();
						dataSyncMtc.targetId = store.settings.id();

						dataSyncMtc.addFile(mtl.seriesId + "." + mtl.seqNum + ".mtl", "TransactionLog", mtl.toJSON());

						return fs.writeFile(destinationDir, dataSyncMtc.fileName, JSON.stringify(dataSyncMtc), true)
							.then(function () {
								return mtl.seqNum;
							});
					}

					function moveXactsToPosted() {
						return store.postOutgoingMtlXacts(mtl.seriesId, mtl.seqNum);
					}

					function updateSeqNum() {
						return store.settings.inSeqNum(mtl.seqNum + 1);
					}

				}, AH.resolve());

				logMessage("Preparing to upload " + mtls.length + " file(s)...");

				return AH.notify(Message.getMessage(Constants.messageCodes.preparingUpload), promise);
			}
		}

		/**
		 * @method mdoTransaction
		 *
		 * Executes and wraps all mdo operations within that callback in a single M-Tier and database transaction.
		 * The callback must return a promise that resolves when all mdo/database operations have completed.
		 *
		 * ## Usage:
		 *
		 *		ds.mdoTransaction(function() {
		 *			var promises = [];
		 *			_.each(mdoElts, function(mdoElt) {
		 *				promises.push(mdoElt.destroy());
		 *			});
		 *
		 *			var fileElt = mdoCon.createElement("Attachment");
		 *			fileElt.setFile(file);
		 *			promises.push(fileElt.save());
		 *
		 *			return AH.whenAll(promises);
		 *		});
		 *
		 * @param {Function} callback
		 * Function that performs MDO operations
		 *
		 * @return {Promise}
		 * Promise that resolves when the Transaction is complete
		 */
		function mdoTransaction(callback) {
			return openPromise
				.then(executeMdoTransaction);

			function executeMdoTransaction() {
				return store.mdoTransaction(callback);
			}
		}

		/**
		 * @method getRows
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the rows
		 *
		 * @param {boolean} [config.fromServer]
		 * If true, rows will be retrieved from the server. Otherwise, rows will
		 * be retrieved from the local store.
		 *
		 * @param {number} [config.timeout=120000]
		 * If fromServer is true, the duration, in milliseconds, for the DataStore to wait before the request is considered to have timed-out.
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object.<string,string|number>} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {String[]|Number[]} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @param {Object} [config.queryconfig]
		 * additional config to apply to the query
		 *
		 * @param {string} [config.queryconfig.filter]
		 * MDO style filter to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahAsset = '01234' and $ahAssetRef.ahType = 'someType'
		 *
		 * @param {string} [config.queryconfig.orderBy]
		 * MDO style orderBy to apply to the query.
		 * ## Usage:
		 *     $ahAssetRef.ahName DESC
		 *
		 * @param {number} [config.queryconfig.limit]
		 * Maximum number of rows to return.
		 *
		 * @param {number} [config.queryconfig.offset]
		 * Offset of the first row to return.
		 *
		 * @param {String[]} [config.queryconfig.fields]
		 * Columns to include in the query.
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		function getRows(config) {
			return openPromise.then(function () {
				return config.fromServer
					? remoteQuery()
					: localQuery();
			});
			

			function remoteQuery () {
				return server.getRows(config);
			}

			function localQuery () {
				return store.getRows(config);
			}
		}

		/**
		 * @method getCount
		 * Retrieves rows from 'classname' identified by the parameters
		 *
		 * @param {Object} config
		 * Parameters dictiating how to retrieve the count
		 *
		 * @param {boolean} [config.fromServer]
		 * If true, rows will be retrieved from the server. Otherwise, rows will
		 * be retrieved from the local store.
		 *
		 * @param {number} [config.timeout=120000]
		 * If fromServer is true, the duration, in milliseconds, for the DataStore to wait before the request is considered to have timed-out.
		 *
		 * @param {string} config.className
		 * name of the class to query against
		 *
		 * @param {string|Object.<string,string|number>} [config.filter]
		 * content of the 'WHERE' clause to use in selecting rows OR an object / MdoElement 'filter'
		 *
		 * @param {string[]|number[]} [config.filterParams]
		 * values used to complete paramaterized filter
		 *
		 * @return {Promise.<Array>}
		 * Resolves with the retrieved rows.
		 */
		function getCount(config) {
			return openPromise.then(function () {
				return config.fromServer
					? server.getCount(config)
					: store.getCount(config.className, config.filter, config.filterParams);
			});
		}

		// ## Internal Methods

		/**
		 * @method logMessage
		 * @private
		 * Uses the logger to log a message with the datastore's Id
		 *
		 * @param {string} message
		 *
		 * @param {Object} [options]
		 *
		 * @return {Promise}
		 * Resolves when the message has been logged
		 */
		function logMessage(message, options) {
			logger.log(message, _.extend({
				domainId: dsInfo.id(),
				category: "INFO"
			}, options));
		}

		exports = {
			open: open,
			close: close,
			deployModel: deployModel,
			processDataSyncs: processDataSyncs,
			prepareOutgoingMtcs: prepareOutgoingMtcs,
			getRows: getRows,
			getCount: getCount,
			destroy: destroy,
			validateClassName: validateClassName,
			/**
			 * @property {LocalStorage.DataStore} dsInfo
			 * Contains the info pertaining to this datastore, such as the datastore's id.
			 */
			dsInfo: dsInfo,

			mdoTransaction: mdoTransaction,

			_internal: {
				applyIncomingMtlGroup: applyIncomingMtlGroup,
				prepareOutgoingMtls: prepareOutgoingMtls
			}
		};

		Object.defineProperties(exports, {
			/**
			 * @property {Data.Store}
			 * Store used by the DataStore to access local data
			 */
			store: {
				get: function () {
					return store;
				}
			},
			/**
			 * @property {Data.Server}
			 * Server used by the DataStore to access remote data
			 */
			server: {
				get: function () {
					return server;
				}
			},
			/**
			 * @property {MDO.Vault}
			 * Vault used by the DataStore to store/access file attachments.
			 */
			vault: {
				get: function () {
					throwIfClosed();

					return store.vault;
				}
			},
			/**
			 * @property {DataModel.Model}
			 * Model representing the underlying schema used by the DataStore.
			 */
			model: {
				get: getModel
			},
			/**
			 * @property {Settings.DataStore}
			 * Settings for the DataStore, such as id, inSeqNum, outSeqNum, etc.
			 */
			settings: {
				get: function () {
					throwIfClosed();

					return store.settings;
				}
			},
			/**
			 * @property {boolean} isOpen
			 * Returns true if there is an open connection to the underlying data store.
			 */
			isOpen: {
				get: function() {
					return isOpen;
				}
			}
		});


		return _.extend(exports, AsyncEvents);
	};

});

/**
 * @class MDO.Domain
 * @private
 * Class representing an M-Tier Domain object which manages user authentication
 * and local data stores.
 *
 * It persists its settings using the `LocalStorage/Domain` class.
 *
 * ## Class methods:
 *
 *	* `retrieve()`: returns the Domain singleton or `undefined`, if not installed
 *	* `create(domainInfo)`: creates the Domain singleton with information in `domainInfo`
 *
 * ## Instance methods and properties:
 *
 *	* `destroy()`: Deletes databases files and settings used by domain and all data stores
 *	* `addDatastore(dsSettings)`: Adds a new datastore to the registry
 *	* `getDatastoreById(id)`: Returns `MDO.Datastore` instance identified by `id`
 *	* `getDatastoreByName(name)`: Returns `MDO.Datastore` instance identified by `name`
 *	* `removeDatastoreById(ImageData)`: Removes the datastore identified by `id` from the database and registry
 *
 *	* domInfo: The `LocalStorage/Domain` settings for this domain
 */
define('MDO/Domain',[
	"underscore",
	"backbone",
	"LocalStorage/Domain",
	"LocalStorage/Datastore",
	"Http/Server",
	"./Datastore",
	"./Error",
	"Files/fs",
	"Logging/logger",
	"Files/Mtc",
	"AH",
	"Constants",
	"Messages/Message"
], function (
	_,
	Backbone,
	DomainInfo,
	DatastoreInfo,
	HttpServer,
	Datastore,
	MdoError,
	fs,
	logger,
	Mtc,
	AH,
	Constants,
	Message
	) {

	"use strict";

	// ### the Domain
	//
	// Currently deployed domain
	//
	var theDomain;
	var exports;

	// ## MDO/Domain
	//
	// Class representing access to the domain.
	//
	// Usage:
	//
	//		var domInfo = ...; // LocalStorage.Domain instance
	//		var dom = new Domain(domInfo);
	//		dom.open().then(...);
	//

	function MdoDomain(domInfo) {

		var datastores = {};
		var _password;

		// ## domain.destroy()
		//
		// Deletes databases files and settings used by domain and all data stores
		//
		// Returns a promise
		//
		function destroy() {
			return removeDatastores()
				.then(function () {
					logMessage(AH.format("Removing domain: {0}", domInfo.name()));
					domInfo.remove();
					theDomain = undefined;
				});

			function removeDatastores() {
				var promises = [];
				if (domInfo) {
					_.each(domInfo.dataStoreIds(), function (dsId) {
						logMessage(AH.format("Removing datastore:  {0}", dsId));
						promises.push(removeDatastoreById(dsId));
					}, this);
				}

				return AH.whenAll(promises);
			}
		}

		// ## domain.getDatastoreById(id)
		//
		// Returns `MDO.Datastore` instance identified by `id` or null if one doesn't exist
		//
		var getDatastoreById = _getDatastoreById;
		function _getDatastoreById(id) {
			var store = datastores[id];
			if (!store) {
				var ds = domInfo.getDatastoreById(id);
				if (ds) {
					datastores[id] = store = new Datastore(ds, new HttpServer(domInfo.serverUrl(), getServerCredentials));
					return store;
				}
			}
			return store;
		}

		function getServerCredentials () {
			return {
				domainId: domInfo.id(),
				userId: domInfo.userId(),
				user: domInfo.user(),
				password: _password,
				deviceSharing: domInfo.device() ? Constants.deviceSharing.existingUser : Constants.deviceSharing.none
			};
		}

		// ## domain.getDatastoreByName(name)
		//
		// Returns `MDO.Datastore` instance identified by `name`
		//
		function getDatastoreByName(name) {
			var num = domInfo.getNumDatastores();
			for (var i = 0; i < num; i++) {
				var dsInfo = domInfo.getDatastore(i);
				if (dsInfo.name() === name) {
					return getDatastoreById(dsInfo.id());
				}
			}
			return null;
		}

		// ## domain.getDefaultDatastore()
		//
		// Returns the default `MDO.Datastore` instance
		//
		// Throws an exception unless there is exactly one datastore.
		//
		function getDefaultDatastore() {
			var num = domInfo.getNumDatastores();
			if (!num) {
				throw new Error("No datastores");
			}
			if (num > 1) {
				throw new Error("Cannot determine default datastore (" + num + " datastores)");
			}
			return getDatastoreById(domInfo.getDatastore(0).id());
		}

		// ## domain.addDatastore(dsSettings)
		//
		// Adds an `MDO.Datastore` instance to the domain
		// with the `{ name, id }` specified by `domainInfo`
		//
		function addDatastore(dsSettings) {
			if (!dsSettings) {
				throw new Error("MDO.Domain.addDatastore: settings not specified");
			}
			if (!dsSettings.id) {
				throw new Error("MDO.Domain.addDatastore: id not specified");
			}
			if (!dsSettings.name) {
				throw new Error("MDO.Domain.addDatastore: name not specified");
			}
			var dsInfo = domInfo.addDatastore(dsSettings.id);
			dsInfo.id(dsSettings.id);
			dsInfo.name(dsSettings.name);
		}

		// ## domain.removeDatastore(id)
		//
		// Removes the datastore identified by `id` from the database and registry
		//
		// Returns a promise
		//
		function removeDatastoreById(id) {
			var store = getDatastoreById(id);
			return store.destroy()
				.then(function () {
					// remove datastore from cache
					delete datastores[id];

					// remove local storage object
					return domInfo.removeDatastore(id);
				});
		}

		// ## extractIncoming()
		//
		// Extracts Mtcs and places Mtls in their appropriate directory
		// (e.g. Places data mtl's in the proper datastore's **Install** directory)
		//
		// Returns a promise that is resolved when all 'incoming' files have been extracted
		// and/or moved to the appropriate directory
		//
		function extractIncoming() {
			return fs.listFiles(domInfo.incomingDir())
				.then(extractFiles);

			function extractFiles(fileInfos) {

				if (!fileInfos.length) {
					return false;
				}

				logMessage(fileInfos.length + " files(s) to extract:");

				return _.reduce(fileInfos, extractIncomingFile, AH.resolve());

				function extractIncomingFile(promise, fileInfo, idx) {
					logMessage("Extracting '" + fileInfo.name + "' (" + fileInfo.size + " bytes)...");

					var filePromise = AH.when(promise)
						.then(readFile)
						.then(extractMtc)
						.then(deleteFile);

					return AH.notify(Message.getMessage(Constants.messageCodes.extractingFile, idx + 1, fileInfos.length), filePromise);

					function deleteFile() {
						return fs.deleteFile(fileInfo.dir, fileInfo.name);
					}

					function readFile() {
						return fs.readJsonFileContent(fileInfo.path);
					}
				}
			}
		}

		// ## extractMtc(mtc)
		//
		// Extracts incoming datastore mtc files to the appropriate location
		//
		// Mdm: /DataStores/Install/<datastoreId>.<deployment-version>/
		// Mtl: /DataStores/<datastoreId>/Incoming
		// DS Settings: /DataStores/Install/
		//
		// Returns a promise that is resolved when the incoming datastore mtc files have been extracted
		//
		function extractMtc(mtc) {
			switch (mtc.descriptor.type) {
				case "DataStore":
				case "DataSync":
				case "Settings":
					return extractMtcFiles(mtc);
				default:
					return AH.reject(new Error("Unknown MTC type: " + mtc.descriptor.type));
			}
		}

		// ## extractMtcFiles(mtc)
		//
		// Extracts incoming datastore files to the appropriate location
		//
		// Mdm: /DataStores/Install/<datastoreId>.<deployment-version>/
		// Mtl: /DataStores/<datastoreId>/Incoming
		// DS Settings: /DataStores/Install/
		//
		// Returns a promise that is resolved when the incoming datastore files have been extracted
		//
		function extractMtcFiles(mtc) {
			var datastoreId = mtc.descriptor.contentId;
			var segmentIndex = mtc.segmentIndex;
			var files = mtc.files;
			var promise = AH.resolve();

			_.each(files, function (file) {
				promise = promise.then(function () {
					return extractFile(file);
				});
			});

			return promise;

			function extractFile(file) {
				if (!AH.isDefined(file)) {
					return AH.reject(new MdoError("Cannot process null file", Constants.errorCodes.invalidFile));
				} else if (file.type === "DataModel") {
					return extractModel(file);
				} else if (file.type === "DataStoreSettings") {
					return extractSettings(file);
				} else if (file.type === "TransactionLog") {
					return extractMtl(file);
				} else if (file.type === "Segmented") {
					// Don't process segmented file
				}
			}

			function extractModel(model) {
				var modelDir = domInfo.getDSDeploymentModelDir(datastoreId, model.version);

				return fs.writeJsonFile(modelDir, model.fileName, model, true);
			}

			function extractSettings(settings) {
				return fs.writeJsonFile(domInfo.dsDeploymentsDir(), settings.fileName, settings, true);
			}

			function extractMtl(mtl) {
				var datastore = getDatastoreById(datastoreId);
				if (segmentIndex) {
					mtl.segmentIndex = segmentIndex;
				}
				if (datastore) {
					datastore.open();
					return datastore.store.addIncomingMtl(mtl);
				}

				var dsIncomingDir = DatastoreInfo.getIncomingDir(datastoreId);
				var fileName = segmentIndex ? segmentIndex + "." + mtl.fileName : mtl.fileName;
				return fs.writeJsonFile(dsIncomingDir, fileName, mtl, true);
			}
		}

		// ## domain.processDataSyncs()
		//
		// Process incoming data sync MTL in all datastores
		//
		// Returns a promise that is resolved when all incoming files have been processed
		//
		var processDataSyncs = _processDataSyncs;
		function _processDataSyncs() {
			return getDatastores().reduce(function (promise, ds, idx) {
				ds.open();
				return promise
					.then(_.bind(ds.processDataSyncs, ds));
			}, AH.resolve());
		}

		// ## domain.processIncomingFiles()
		//
		// Processes incoming files
		//
		// Returns a promise that is resolved when all incoming files have been processed
		//
		function processIncomingFiles() {
			var inSeriesIdWasReset;
			return processDeployments()
				.then(function (dataReset) {
					inSeriesIdWasReset = dataReset;
				})
				.then(processDataSyncs)
				.then(function() {
					if (inSeriesIdWasReset) {
						return AH.whenAll(getDatastores().map(function(ds) {
							return ds.store.deleteIncomingMtlsNotFromSeries(ds.settings.outSeriesId());
						}));
					}
				})
				.then(notifyIfSeriesIdWasReset, function (err) {
					notifyIfSeriesIdWasReset();
					return AH.reject(err);
				});

			function notifyIfSeriesIdWasReset() {
				if (inSeriesIdWasReset) {
					// Trigger event after deployments/data has been applied
					exports.trigger(Constants.connectionEvents.dataReset);
				}
			}
		}

		// ## domain.getDatastores()
		//
		// Returns all MDO.Datastores in this domain
		//
		function getDatastores() {
			return (domInfo.dataStoreIds() || []).map(getDatastoreById, this);
		}

		// ## domain.processDeployments()
		//
		// Processes pending data deployments
		//
		// Returns a promise that is resolved with a bool when all pending deployments have been processed.
		// The resolution value indicates whether the in-series-id was reset.
		//
		function processDeployments() {

			var inSeriesIdWasReset = false;

			return fs.listFiles(domInfo.dsDeploymentsDir(), null, fs.pathSeqNumCompare)
				.then(readDeploymentFiles)
				.then(function () {
					return AH.resolve(inSeriesIdWasReset);
				});

			function readDeploymentFiles(fileInfos) {
				return _.reduce(fileInfos, processDeploymentFile, AH.resolve());

				function processDeploymentFile(promise, fileInfo) {
					return promise
						.then(readFile)
						.then(processDeployment);

					function readFile() {
						return fs.readJsonFile(fileInfo.path);
					}
				}
			}

			function processDeployment(file) {
				var ds;
				var dsInfo;
				var settings = file.content;
				var isInitialDeployment;
				var isDataRepost = settings.deploymentType === "Create" && !settings.inSeriesId;

				// Flag that is true when the deployment
				// is a hard installation or a soft installation
				var isInstallation = (settings.deploymentType === "Create" && !isDataRepost)
					|| settings.deploymentType === "CreateIfMissing";

				var hasInSeriesIdReset;

				var modelString;

				return AH.deferredTryCatch(function () {
					// Try to find a datastore with the id of the settings file,
					// or create one if it doesn't already exist
					dsInfo = domInfo.getDatastoreById(settings.dataStoreId);
					isInitialDeployment = !dsInfo;

					if (isInitialDeployment && !isInstallation) {
						throw new Error("Device is not installed!");
					}

					return createDatastoreIfNeeded()
						.then(importMtlsFromFs)
						.then(loadModelString)
						.then(deleteOldOutgoingXacts)
						.then(function () {
							return ds.store.transaction(function () {
								return applyDatastoreSettings()
										.then(resetDatastoreIfNeeded)
										.then(deployModelIfNeeded)
										.then(processDsDataSyncs);
							});
						})
						.then(deleteDeploymentFiles);
				});

				function createDatastoreIfNeeded() {
					if (isInitialDeployment) {
						dsInfo = domInfo.addDatastore(settings.dataStoreId);
						dsInfo.name(settings.name);
					}

					ds = getDatastoreById(dsInfo.id());

					return ds.open()
						.then(function () {
							hasInSeriesIdReset = !isInitialDeployment
								&& settings.inSeriesId
								&& ds.settings.inSeriesId() !== settings.inSeriesId;
							if (hasInSeriesIdReset) {
								inSeriesIdWasReset = true;
							}
						});
				}

				function importMtlsFromFs() {
					if (!isInitialDeployment) {
						return false;
					}

					return ds.store.importIncomingMtlsFromFs();
				}

				function loadModelString() {
					if (!isDataRepost) {
						var modelPath = domInfo.getDSDeploymentModelPath(settings);

						return fs.readFile(modelPath)
							.then(function (modelFile) {
								return (modelString = modelFile.content);
							});
					}
				}

				//
				// Deletes all 'Outgoing' (from the client's point of view) xacts and resets the temp id cache
				//
				function deleteOldOutgoingXacts() {
					if (hasInSeriesIdReset) {
						return fs.deleteFiles(domInfo.outgoingDir(), ds.settings.outgoingMtcFilePattern)
							.then(_.bind(ds.store.emptyTempIdCache, ds.store))
							.then(_.bind(ds.store.purgeAllOutgoingXacts, ds.store));
					}

					return AH.resolve();
				}

				function applyDatastoreSettings() {
					var promises = [];

					if (isInitialDeployment || hasInSeriesIdReset) {
						promises.push(ds.settings.inSeriesId(settings.inSeriesId));
						promises.push(ds.settings.inSeqNum(settings.inSequenceNumber));
					}

					promises.push(ds.settings.outSeriesId(settings.outSeriesId));
					promises.push(ds.settings.outSeqNum(settings.outSequenceNumber));
					promises.push(ds.settings.modelId(settings.modelId));

					return AH.whenAll(promises);
				}

				function resetDatastoreIfNeeded() {
					if (!isInitialDeployment && isInstallation) {
						logMessage("Resetting database...");
						return AH.notify(Message.getMessage(Constants.messageCodes.resettingDatabase), ds.store.reset(true));
					}

					return AH.resolve();
				}

				function deployModelIfNeeded() {
					if (modelString) {
						logMessage("Deploying database...");

						return AH.notify(Message.getMessage(Constants.messageCodes.deployingDatabase), ds.deployModel(modelString));
					}

					return AH.resolve();
				}

				function processDsDataSyncs() {
					return ds.processDataSyncs(isInstallation || isDataRepost);
				}

				function deleteDeploymentFiles() {
					return deleteModel()
						.then(deleteSettings);

					function deleteModel() {
						var modelDir = domInfo.getDSDeploymentModelDir(settings.dataStoreId, settings.modelVersion);
						return fs.deleteDirectory(modelDir);
					}

					function deleteSettings() {
						return fs.deleteFile(file.path);
					}
				}
			}
		}

		// ## domain.prepareOutgoingFiles()
		//
		// Prepares files that need to be uploaded to the server
		//
		// Returns a promise that is resolved when all outgoing files have been prepared
		//
		function prepareOutgoingFiles() {
			if (!domInfo.dataStoreIds()) {
				return AH.resolve();
			}

			return domInfo.dataStoreIds().reduce(function (previous, dsId) {
				return AH.when(previous, function () {
					var ds = getDatastoreById(dsId);
					ds.open();
					return ds.prepareOutgoingMtcs(domInfo.outgoingDir());
				});
			}, AH.resolve());
		}

		// ## domain.logMessage(message, options)
		//
		// Uses the logger to log a message with the domain's Id
		//
		// Returns a promise that is resolved when log operation completes
		//
		function logMessage(message, options) {
			return logger.log(message, _.extend({}, {
				domainId: domInfo.id(),
				category: "INFO"
			}, options));
		}

		// ## domain.logError(error, options)
		//
		// Uses the logger to log an error with the domain's Id
		//
		// Returns a promise that is resolved when log operation completes
		//
		function logError(error, options) {
			return logger.logError(error, _.extend({}, {
				domainId: domInfo.id()
			}, options));
		}

		exports = {
			destroy: destroy,
			addDatastore: addDatastore,
			getDefaultDatastore: getDefaultDatastore,
			removeDatastoreById: removeDatastoreById,
			getDatastoreByName: getDatastoreByName,
			extractIncoming: extractIncoming,
			extractMtc: extractMtc,
			processIncomingFiles: processIncomingFiles,
			prepareOutgoingFiles: prepareOutgoingFiles,
			logMessage: logMessage,
			logError: logError,
			domInfo: domInfo,

			_internal: {
				extractMtcFiles: extractMtcFiles
			}
		};

		// Mix-in events
		_.extend(exports, Backbone.Events);

		Object.defineProperties(exports, {
			getDatastoreById: {
				get: function () {
					return getDatastoreById;
				},
				set: function (value) {
					getDatastoreById = value;
				}
			},
			serverPassword: {
				set: function (value) {
					_password = value;
				},
				get: function() {
					throw new Error("password cannot be read");
				}
			}
		});

		Object.defineProperties(exports._internal, {
			processDataSyncs: {
				get: function () {
					return processDataSyncs;
				},
				set: function (value) {
					processDataSyncs = value;
				}
			}
		});

		return exports;
	}

	// ### retrieveDomain(nameOrID)
	//
	// Returns the deployed MDO.Domain or `undefined`.
	//
	// [nameOrID] - the deployed domain's name or ID must match this value when specified
	//
	function retrieveDomain(nameOrID) {

		// NOTE: Would need to add support for multiple domains -> LocalStorage/Domain.retrieve(nameOrID)
		var domInfo = theDomain ? theDomain.domInfo : DomainInfo.retrieve();

		if (!domInfo) {
			return null;
		}

		// NOTE: name & id checks can be removed when multiple domain support is implemented
		if (nameOrID && domInfo.name() !== nameOrID && domInfo.id() !== nameOrID) {
			return null;
		}

		if (!theDomain) {
			theDomain = new MdoDomain(domInfo);
		}

		return theDomain;
	}

	// ### createDomain(domInfo)
	//
	// Returns a newly create MDO.Domain initialized with `domInfo`
	//
	function createDomain(info) {

		if (retrieveDomain()) {
			throw new Error("MdoDomain.create: another domain already exists");
		}

		var domInfo = DomainInfo.create();
		domInfo.name(info.domain);
		domInfo.id(info.domainId);
		if (info.sharedDevice) {
			// `user` corresponds to the DeviceAccount
			domInfo.device(info.user);
		} else {
			// `user` corresponds to the DeviceUser
			domInfo.saveCredentials(info.user, info.password);
		}
		domInfo.userId(info.userId);
		domInfo.serverUrl(info.serverUrl);

		theDomain = new MdoDomain(domInfo);
		return theDomain;
	}

	MdoDomain.create = createDomain;
	MdoDomain.retrieve = retrieveDomain;

	return MdoDomain;


});
/**
 * @class MDO.QueryIncludeMixin
 * @private
 *
 * Mixin providing `queryInclude` functionality.
 *
 * Used by {@link MDO.Collection#queryInclude} and {@link MDO.Element#queryInclude}.
 */
define('MDO/QueryIncludeMixin',["underscore"], function(_) {
	"use strict";

	return {
		/**
		 * @method queryInclude
		 * @chainable
		 * @private
		 *
		 * Include the specified `elementName` in fetched entities. If the Foreign Key
		 * is null or the Foreign Key is for an element that does not exist, then the attribute will be populated with 'null'.
		 *
		 * Calling this method multiple times can include multiple element references.
		 *
		 * @param {String} elementName
		 *
		 * Name of element reference to include.
		 * The name can be simple (e.g. `'ahSiteRef'`) or merged (e.g. `'ahSiteRef.ahLocationRef'`).
		 *
		 * @param {Object} [options]
		 *
		 * @param {Array} [options.fields=undefined (include all fields)]
		 *
		 * Names of fields to include when fetching referenced elements. If not specified, all fields will be fetched.
		 *
		 * @return {Object}
		 *
		 * Returns self.
		 */
		queryInclude: function(elementName, options) {

			var elementRefs = elementName.split(".");
			var mdoClass = this.mdoClass;
			var mergedName = "";
			var config = _.extend({ fields: true }, options);
			var self = this;

			// includedRefs is a hash of (merged) refs
			//      the "" key represents the current collection
			//      the values can be
			//          true - indicating ALL fields
			//          array - representing field names to be fetched
			this.includedRefs = this.includedRefs || {};

			_.forEach(elementRefs, function (eltRefName) {
				// Get reference from model to throw if it doesn't exist
				var element = mdoClass.allElements.getByName(eltRefName, true);
				mdoClass = element.refClass;

				// Add current fkey to list of fields fetched by leader reference
				addFields(mergedName, [element.referenceField.name]);

				if (mergedName) {
					mergedName += ".";
				}
				mergedName += eltRefName;

			}, this);

			addFields(mergedName, config.fields);

			function addFields(mergedElement, fields) {
				self.includedRefs[mergedElement] = self._mergeFieldsToFetch(self.includedRefs[mergedElement], fields);
			}

			// Allow chaining
			return this;
		},

		/**
		 * @method _mergeFieldsToFetch
		 * @private
		 *
		 * Returns `existingFields` combined with `fields`.
		 * If either is `true`, returns `true`, otherwise returns and array.
		 *
		 * @param {Array} [existingFields=undefined]
		 *
		 * List of existing field names.  Passing `true` indicates all fields.
		 *
		 * @param {Array} [fields=undefined]
		 *
		 * List of field names to be added.  Passing `true` indicates all fields.
		 *
		 * @returns {*}
		 *
		 * Can return `undefined`, array if field names or `true`.
		 */
		_mergeFieldsToFetch: function(existingFields, fields) {
			if (existingFields !== true && fields) {
				// Currently a subset of fields is specified
				if (fields === true) {
					// Use all fields
					return true;
				} else if (!existingFields) {
					// Use specified fields
					return fields;
				}

				// Combine fields
				return _.union(existingFields, fields);
			}

			return existingFields;
		},

		/**
		 * @method _getFetchOptions
		 * @private
		 * Construct fetched option based on original `options` and adding any `fields` necessary
		 * for the specified mergedName reference.
		 *
		 * @param mergedName
		 *
		 * @param {Object} [options]
		 *
		 * @returns {Object} options to be passed to the fetch method.
		 */
		_getFetchOptions: function(mergedName, options) {
			if (!this.includedRefs) {
				return options;
			}

			// Default to all fields
			var fetchOptions = _.extend({ fields: true }, options);

			// Merge in fkeys to included refs
			fetchOptions.fields = this._mergeFieldsToFetch(fetchOptions.fields, this.includedRefs[mergedName]);

			if (fetchOptions.fields === true) {
				// Fetching ALL fields
				if (!options) {
					fetchOptions = options;
				} else {
					delete fetchOptions.fields;
				}
			}

			return fetchOptions;
		}

	};
});

// MDO/Element
//
define('MDO/Element',[
	"underscore",
	"backbone",
	"AH",
	"Constants",
	"./Error",
	"./QueryIncludeMixin"
], function (
	_,
	Backbone,
	AH,
	Constants,
	MdoError,
	QueryIncludeMixin
	) {

	"use strict";

	/**
	 * @class MDO.Element
	 *
	 * A single, strongly typed record in the M-Tier datastore.
	 *
	 * Created via {@link MDO.Connection#createElement}.
	 *
	 * ### Generated Field Properties
	 *
	 * In addition to the built-in properties, an MDO.Element also provides setter and getter properties for
	 * all the fields in the {@link MDO.Element#mdoClass Element.mdoClass}.
	 *
	 * #### Example:
	 *
	 * If the `Person` Model.Class has a field `FirstName`, the following three assignments are equivalent:
	 *
	 *     var mdoEltPerson = mdoCon.createElement("Person");
	 *
	 *     mdoEltPerson.set("FirstName", "Bob");
	 *     mdoEltPerson.set({ FirstName: "Bob" });
	 *     mdoEltPerson.FirstName = "Bob";
	 *
	 * Similarly the following two assignments are equivalent:
	 *
	 *     name = mdoEltPerson.get("FirstName");
	 *     name = mdoEltPerson.FirstName;
	 *
	 * #### Normalization:
	 *
	 * When setting the value of a field, MDO normalizes the value to match the type and resolution of the field.
	 * See {@link MDO.Element#set Element.set()} for more information.
	 *
	 * If the `Person` Model.Class has a field `Age` of type `Int16`, the following three assignments are equivalent
	 * and will set the Age field to `25`:
	 *
	 *     mdoEltPerson.Age = "25";
	 *     mdoEltPerson.Age = "25.3";
	 *     mdoEltPerson.Age = 24.7;
	 *     mdoEltPerson.Age = 25;
	 */
	var MdoElement = Backbone.Model.extend({

		// Array of field names that we do not want to include in MTL Xacts generated on the client - or null
		localOnlyFields: null,

		// ## Initialize an instance of an MDO element
		//
		// Sets initial attributes and `className`
		//
		initialize: function (attributes, options) {
			options = options || {};
			this._state = options.collection ? Constants.elementStates.saved : Constants.elementStates.new;
			this.originalAttributes = _.clone(attributes);
		},

		/**
		 * @method toString
		 *
		 * Return a string consisting of the class name and PKey value, e.g. `AH_User{23}`.
		 *
		 * @returns {string}
		 */
		toString: function() {
			return this.mdoClass.name + "{" + (this.id || "") + "}";
		},

		/**
		 * @method set
		 *
		 * Sets values of fields in an MDO.Element.  Assigning a value to an invalid field name throws an Error.
		 * Assigning a value that cannot be converted to the field's type (type not compatible or value out of range)
		 * throws a validation Error.
		 *
		 * When setting a single field value, the name and value can be passed as separate arguments instead of the `attributes` object.
		 *
		 * ## Value Normalization:
		 *
		 * Assigning the value of `undefined` will cause the field to be set to `null`.
		 * Other values are normalized depending on the field's type:
		 *
		 * |Field Type|Conversion|
		 * |:-----|:------|
		 * |Text|Value is converted to a `String`|
		 * |Int8, Int16, Int32|Value is rounded to nearest `Integer`|
		 * |Float64|Value is converted to a `Number`|
		 * |Decimal|Value is converted to a `Fixed Number`|
		 * |Date, Time, DateTime, Timestamp|Value is converted to a `Date`|
		 *
		 *
		 * ## Usage:
		 *
		 *     mdoElt.set({ ahFirst: "John", ahLast: "Doe" });
		 *     mdoElt.set("ahStatus", "ACTIVE", { silent: true });
		 *
		 * @param {Object} attributes
		 * Fields to be set.
		 *
		 * @param [options]
		 * Additional options for this operation.
		 *
		 * @param {boolean} [options.silent=false]
		 * Prevent `change` events from being fired.
		 *
		 * @returns {MDO.Element}
		 * Value can be used for chaining operations.
		 *
		 * @throws {Error}
		 * Fails if a field name is not valid or a value is out of range.
		 *
		 * @fires change
		 *
		 */
		set: function (attributes, options) {
			// Add mdoElt.set(name, value) overload
			if (!_.isObject(attributes)) {
				var attrs = {};
				attrs[arguments[0]] = arguments[1];
				attributes = attrs;
				options = arguments[2];
			} else {
				attributes = _.clone(attributes);
			}

			// We want to immediately validate bogus fields
			options = _.extend({ validate: true }, options);

			// Normalize values
			if (options.validate) {
				var fields = this.mdoClass.allFields;
				_.forEach(attributes, function(value, key) {
					var field = fields.getByName(key, false);
					if (field) {
						attributes[key] = field.normalizeValue(value);
					}
				}, this);
			}

			delete this._error;
			var result = Backbone.Model.prototype.set.call(this, attributes, options);
			if (this._error) {
				throw (this._error instanceof Error) ? this._error : new Error(this._error);
			}

			if (this._state === Constants.elementStates.saved && this.hasChanged()) {
				this._state = Constants.elementStates.changed;
			}
			return result;

		},

		/**
		 * @method get
		 *
		 * Returns the value of a field in an MDO.Element. Merged references are also supported for
		 * element references that have been fetched with {@link #queryInclude}.
		 *
		 * ## Usage:
		 *
		 *     var ahUser = ...
		 *     var name = ahUser.get("ahLogin");
		 *
		 *     var ahLocation = ...
		 *     var parentLocationName = ahLocation.get("ahParentRef.ahParentRef.ahLocation");
		 *
		 * @param {string} fieldName
		 * Name of the field to read
		 *
		 * @returns {*}
		 * Value of the field, or `undefined` if this element has not been fetched,
		 * or `undefined` if one of the elements in a merged reference is `null`.
		 *
		 * @throws {MdoError}
		 * if the field specified does not exist for this element.
		 *
		 * @throws {MdoError}
		 * if one of the specified elements does not exist or is not fetched in a merged reference
		 */
		get: function (fieldName) {
			// Check for a merged reference
			var mergedRemainder = null;
			var mergedIndex = fieldName.indexOf(".");
			if (mergedIndex > -1) {
				mergedRemainder = fieldName.substring(mergedIndex + 1);
				fieldName = fieldName.substring(0, mergedIndex);
				if (!mergedRemainder || !fieldName) {
					throw new MdoError("Invalid Merged Reference: " + fieldName, Constants.errorCodes.invalidMergedReference);
				}
			}

			// Validate field name, and throw an exception if it doesn't exist
			var fieldOrElement = this.mdoClass.getEltOrFieldByName(fieldName, false);

			if (!fieldOrElement) {
				throw new MdoError(this._createFieldValidationError(fieldName, "Invalid field name"), Constants.errorCodes.unknownFieldOrElement);
			}

			// Check if were getting a field or element, and handle appropriately
			if (!fieldOrElement.refClassId) {
				// Dealing with a field
				
				// Can't follow a merged reference along a field
				if (mergedRemainder) {
					throw new MdoError(this._createFieldValidationError(fieldName, "Invalid merged reference (" + fieldName + "." + mergedRemainder + ") - field is not an element reference"),
						Constants.errorCodes.invalidMergedReference);
				}
				// Fetch the field value from the model.
				var val = Backbone.Model.prototype.get.call(this, fieldName);
				// Resolve potential temporary IDs if we're grabbing a reference.
				val = fieldOrElement.element || fieldName === this.idAttribute ? this._ds.store.resolveTempId(val) : val;

				return val;
			}

			// Dealing with a reference
			var element = this[fieldName];
			// make sure the element was query-included or is set
			if (element !== null && !(element instanceof MdoElement)) {
				throw new MdoError(this._createFieldValidationError(fieldName, "Could get element reference because element was not fetched. Did you queryInclude() ?"),
					Constants.errorCodes.invalidMergedReference);
			}

			// If we're not resolving a merged reference, just return the element
			if (!mergedRemainder) {
				return element;
			}
			// If the element that we're looking at is null, than null-coalesce the remainder of the merged reference to undefined
			if (element === null) {
				return undefined;
			}
			// Recursively continue to resolve the merged reference
			return element.get(mergedRemainder);
		},

		// ## original(attr)
		//
		// Returns the original value of the given attribute.
		// The original value represents the value of the attribute when it was last synched with the datastore.
		//
		original: function(attr) {
			if (!this.originalAttributes) {
				return undefined;
			}

			return this.originalAttributes[attr];
		},

		// ## trigger(evt, ...)
		//
		// Overrides Backbone.Model.trigger() to capture reported errors
		//
		trigger: function (evt, elt, arg) {
			if (evt === "invalid") {
				this._error = arg;
			}
			return Backbone.Model.prototype.trigger.apply(this, arguments);
		},

		// ## validate(attrs, options)
		//
		// Returns an error if attrs violate model field definitions (data type and range limits).
		//
		// Does not report missing required values as validation errors!
		//
		validate: function (attrs, options) {
			var name, value, field, i, error;
			var mdoClass = this.mdoClass;
			var keys = _.keys(attrs);
			var validateAllowNull = options && options.validateAllowNull;
			for (i = 0; i < keys.length; i++) {
				name = keys[i];
				field = mdoClass.allFields.getByName(name, false);

				if (!field) {
					return this._createFieldValidationError(name, "Invalid field name");
				}

				if (validateAllowNull) {
					// Field validation will happen in next loop
					continue;
				}

				value = attrs[name];
				error = this._validateFieldValue(field, value, false);
				if (error) {
					return error;
				}
			}

			if (validateAllowNull) {
				// Fully validate all fields
				for (i = 0; i < mdoClass.allFields.length; i++) {
					field = mdoClass.allFields[i];
					name = field.name;
					value = attrs[name];
					if (field.isIdField() && !AH.isDefined(value)) {
						// PKey of new field
						continue;
					}

					error = this._validateFieldValue(field, value, true);
					if (error) {
						return error;
					}
				}
			}
		},

		/**
		 * Helper method that validates that the given value can be assigned to the field. The following validation isperformed:
		 *
		 *   - Value is of correct data type.
		 *   - Value is within the allowed range.
		 *   - Readonly field is not being assigned a value.
		 *   - Required field is not being assigned a null value (only happens if validateAllowNull is 'true').
		 *
		 * @param {DataModel.Field} field
		 * The field being assigned the value
		 *
		 * @param {*} value
		 * The value being applied to the field
		 *
		 * @param {boolean} validateAllowNull
		 * Flag indicating if assigning null to a non-null field should be validated.
		 *
		 * @returns {string|undefined}
		 * An error message if the value cannot be assigned to the field, or `undefined` if it can.
		 *
		 * @private
		 */
		_validateFieldValue: function(field, value, validateAllowNull) {
			var name = field.name;

			// Check if we're trying to change a read-only field
			if (this.original(name) !== value && this._isReadOnlyField(field)) {
				return this._createFieldValidationError(name, "Invalid assignment to readonly field");
			}

			// Validate that the field can accept the value
			if ((validateAllowNull || AH.isDefined(value))) {
				var error = field.validateValue(value);
				if (error) {
					return this._createFieldValidationError(name, "Invalid field value - " + error);
				}
			}
		},

		/**
		 * Helper method that formats a validation error message describing an invalid field as
		 *
		 *     message (class.fieldName)
		 *
		 * where `class` is this element's ModelClass name
		 *
		 * @param {string} fieldName
		 * The name of the invalid field
		 *
		 * @param {string} message
		 * The error message describing why the field is invalid
		 *
		 * @returns {string}
		 * The formatted error message
		 *
		 * @private
		 */
		_createFieldValidationError: function (fieldName, message) {
			return message + " (" + this.mdoClass.name + "." + fieldName + ")";
		},

		/**
		 * Helper method that determines if a given field should be read-only.
		 *
		 * @param {DataModel.Field} field
		 * The field to check
		 *
		 * @returns {boolean}
		 * Flag indicating if the field is read-only or not.
		 *
		 * @private
		 */
		_isReadOnlyField: function(field) {
			// All fields are read-write on an MDO.Element. Subclasses might add restrictions, however.
			return false;
		},

		/**
		 * @method fetch
		 *
		 * Loads the MDO.Element from the database (based on its id) replacing any uncommitted changes. Use the
		 * {@link MDO.Element#queryInclude} method to automatically fetch referenced elements when the referring element
		 * is fetched.
		 *
		 * @param {Object} options
		 *
		 * @param {Array.<string>} [options.fields=undefined]
		 * Names of fields to include in the fetch. If undefined, all fields will be fetched.
		 *
		 * @returns {Promise.<MDO.Element>}
		 * Resolves with MDO.Element when record is fetched from database.
		 *
		 * @async
		 * @fires sync
		 */
		fetch: function(options) {
			// Note, the bulk of this method is handled by sync('read')

			// MdoElement performs validation on every call to 'set', so we need to explicitly
			// disable validation during a fetch
			var promise = Backbone.Model.prototype.fetch.call(this, _.extend({ validate: false },
				this._getFetchOptions("", options)));
			return this.includedRefs
				? promise.then(_.bind(this._fetchRefs, this))
				: promise;
		},

		/**
		 * @method save
		 *
		 * Saves the record to the database.  After saving a new element, its {@link MDO.Element#id} will be set to a unique value.
		 *
		 * ## Basic Usage:
		 *
		 * The following are equivalent:
		 *
		 *     mdoElt.ahStatus = "ACTIVE";
		 *     mdoElt.save();
		 *
		 *     mdoElt.save("ahStatus", "ACTIVE");
		 *
		 *     mdoElt.save({ ahStatus: "ACTIVE" });
		 *
		 * Using an object to specify the fields during the save allows for multiple fields to be set in a single operation:
		 *
		 *     mdoElt.save({ ahFirst: "John", ahLast: "Doe" });
		 *
		 * ## Local-only:
		 *
		 * By default, changes to fields that applied during the save operation are also applied to the server and distributed to other clients during
		 * the next {@link MDO.Connection#sync sync} operation.
		 * Use the `localOnly` option to prevent the field changes to be applied to the server:
		 *
		 *     mdoElt.ahStatus = "ACTIVE";
		 *     mdoElt.save(null, { localOnly: true });
		 *
		 *     mdoElt.save({ ahFirst: "John", ahLast: "Doe" }, { localOnly: true });
		 *
		 *     mdoElt.save("ahStatus", "ACTIVE", { localOnly: true });
		 *
		 * This will commit the element and specified changes to the local device's database, but these changes will not be propagated to the server or other
		 * devices.
		 *
		 * @param {Object|String} key
		 * This may either be a String, which when paired with the `value` parameter will set a single property on
		 * this MDO.Element and then save it to the underlying database, or it may be an Object containing a map of properties to
		 * set on this MDO.Element. If this parameter is either an Object or `null`, then the `value` parameter
		 * is omitted and `options` should be the second parameter to #save.
		 *
		 * @param [value]
		 * If `key` is a String, then this parameter will be assigned to that property on this MDO.Element. Otherwise,
		 * this parameter is omitted entirely, and `options` is the second parameter to #save
		 *
		 * @param {Object} [options]
		 * A map of options to control how this MDO.Element is saved
		 *
		 * @param {boolean} [options.localOnly=false]
		 * `true` if no transactions should be generated for this update; The changes made to this element
		 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs.
		 *
		 * @param {boolean} [options.silent=false]
		 * `true` will cause the {@link MDO.Connection#event-data_modified data_modified} event (if saving an existing
		 * element) and the {@link MDO.Connection#event-data_added data_added} event (if saving a new element) to be
		 * suppressed instead of fired as a result of saving this MDO.Element.
		 *
		 * @returns {Promise.<MDO.Element>}
		 * Resolves with MDO.Element when record is inserted or updated in the database.
		 *
		 * @async
		 * @fires sync
		 */
		save: function (key, value, options) {
			var attrs;

			// Handle both `("key", value)` and `({key: value})` -style calls.
			if (_.isObject(key) || !AH.isDefined(key)) {
				attrs = key;
				options = value;
			} else {
				attrs = {};
				attrs[key] = value;
			}

			return AH.deferredTryCatch(function () {
				// save throws an Error if validation fails - but only validates if we specify attrs
				return Backbone.Model.prototype.save.call(this, attrs || {},
					_.extend({ validateAllowNull: true }, options));
			}, this);
		},

		// ## destroy()
		//
		// Note: Implemented by overriding the Backbone.sync() method

		/**
		 * @method destroy
		 *
		 * Deletes the record and any dependent records from the database (based on its {@link MDO.Element#id}). These changes
		 * will be propagated to the M-Tier server and other devices upon the next successful {@link MDO.Connection#sync sync}
		 *
		 * ## Usage:
		 *
		 *     mdoElt.destroy();
		 *
		 * ## Local-only:
		 *
		 * By default, the delete operation will be applied to the server and distributed to other clients during the next
		 * {@link MDO.Connection#sync sync}.
		 * Use the `localOnly` option to prevent the delete operation to be propagated to the server:
		 *
		 *     mdoElt.destroy({ localOnly: true });
		 *
		 * This will remove the element from the device's local database, but not on the server or other devices' databases.
		 *
		 * @param {Object} [options]
		 * A map of options to control how this MDO.Element is deleted
		 *
		 * @param {boolean} [options.localOnly=false]
		 * `true` if no transactions should be generated for this update; The changes made to this element
		 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs
		 *
		 * @param {boolean} [options.silent=false]
		 * `true` will cause the {@link MDO.Connection#event-data_deleted data_deleted} event to be suppressed instead
		 * of fired as a result of destroying this element.
		 *
		 * @param {boolean} [options.wait=false]
		 * If `true`, then the {@link #event-destroy destroy event will not be fired until the element is removed from
		 * the datastore; otherwise, the event is fired immediately.
		 *
		 * @returns {Promise}
		 * Resolves when the record is deleted from the database.
		 *
		 * @async
		 *
		 * @fires sync
		 * @fires destroy
		 */

		/**
		 * @method resolve
		 * Queries the database for a record whose fields match the currently set non-null attributes of the element.
		 *
		 * @returns {Promise.<MDO.Element>}
		 * Resolves with MDO.Element if a unique row in the database matches the search criteria.
		 *
		 * Rejects if no record or multiple records match the search criteria.
		 *
		 * @async
		 *
		 */
		resolve: function () {
			return this.fetch({ resolve: true });
		},

		// ## getCollection(collectionName, options)

		/**
		 * @method getCollection
		 * Returns an unfetched MDO collection identified by `name` and optional `options` object.
		 *
		 * @param {string} name
		 * Name identifying the model collection to get.
		 *
		 * @param [options]
		 *
		 * @param {string} options.queryFilter
		 * Logical parametrized filter to be applied to the collection.
		 *
		 * @param {Array} options.args
		 * Array of args for the queryFilter
		 *
		 * @returns {MDO.Collection}
		 * Unfetched collection of the appropriate type.
		 *
		 * @throws {Error}
		 * Fails if element is new (without an id) or if an invalid `collectionName` or `queryFilter` is specified.
		 *
		 * ### Usage:
		 *
		 *     var mdoColTasks = mdoElt.getCollection("ahTasks");
		 *
		 *     mdoColTasks.fetch().then(...);
		 *
		 *     var mdoColActiveTasks = mdoElt.getCollection(
		 *         "ahTasks", {
		 *             queryFilter: "$ahStatus=?",
		 *             args: ["ACTIVE"]
		 *         }
		 *     );
		 *
		 *     mdoColActiveTasks.fetch().then(...);
		 */
		getCollection: function (name, options) {
			// strip the [] off the end of the reference to get collection name
			var collectionName = name.replace(/\[\]$/, "");
			// get the appropriate field we're looking up
			var modelCol = this.mdoClass.allCollections.getByName(collectionName, true);
			// build up collection
			var newCollection = this._mdoCon.createCollection(modelCol.colClass.name);
			// filter to the specified pkey
			var refField = modelCol.colClass.allFields.getByFieldId(modelCol.colParentId, true);
			var logicalFilter = "$" + refField.name + " = " + (this.id || 0);
			// add in user-defined filter
			var filterParams = [];
			if (options && options.queryFilter) {
				filterParams = options.args;
				logicalFilter = logicalFilter + " and (" + options.queryFilter + ")";
			}
			newCollection.queryFilter(logicalFilter, filterParams);
			return newCollection;
		},

		// ## fetchCollection(collectionName, options)
		/**
		@method fetchCollection

		Returns a {@link Promise} that resolves with a fetched MDO collection identified by `name` and optional `options`
		object.

		@param {String} collectionName

		Name identifying the model collection to get.

		The `collectionName` can contain leading element references and multiple merged collection references,
		e.g. `"ahWorkOrderRef.ahTasks[].ahTools[]"`

		@param [options]

		Options passed to MDO.Collection#fetch method.  The `fetchCollection` method uses the following options:

		@param {String} options.queryFilter

		Logical parametrized filter to be applied when fetching the collection.

		@param {String} options.querySort

		Logical order clause to be applied when fetching the collection.

		@param {Array} options.args

		Array of arguments for the queryFilter

		@returns {Promise.<MDO.Collection>}

		Fetched collection of the appropriate type.

		@async

		@throws {Error}

		Fails if element is new (without an id) or if an invalid `collectionName` or queryFilter is specified.

		### Usage:

			var mdoColTasksPromise = mdoElt.fetchCollection("ahTasks");

			mdoColTasksPromise.then(...);

			var mdoColActiveTasksPromise = mdoElt.fetchCollection(
				"ahTasks", {
					queryFilter: "$ahStatus=?",
					args: ["ACTIVE"]
				}
			);

			mdoColActiveTasksPromise.then(...);

			var mdoColTaskToolsPromise = mdoElt.fetchCollection(
				"ahTasks[].ahTools[]", {
					querySort: "$ahMaker ASC, $ahPrice DESC",
					queryFilter: "$ahToolType=?",
					args: ["POWER"],
					limit: 20
				}
			);

			mdoColTaskToolsPromise.then(...);

		*/
		fetchCollection: function (colSpecifier, options) {
			options = _.extend({}, options);
			return AH.deferredTryCatch(function () {

				// make sure we actually have something to look up
				if (!colSpecifier) {
					throw new Error("No collection specified");
				}

				// NOTE: We don't support association collections (e.g. Assets[].ahLocationRef)
				var references = colSpecifier.split(".");

				// break apart the collection specifier into leading references, and the merged collection
				var firstCollectionIndex = findFirstCollectionIndex(references, this.mdoClass);
				var leadingReferences = references.slice(0, firstCollectionIndex);
				var mergedCollectionReferences = references.slice(firstCollectionIndex);

				//
				// process the leading reference
				//

				var leadingElementClass = _.reduce(leadingReferences, getElementClass, this.mdoClass);

				// resolve the leading element we're looking up
				var leadingElementPromise;
				if (leadingReferences.length === 0) {
					if (!this.PKey) {
						// `this` is not a valid element, so just use a root that resolves to null.
						// it'll be handled at the end when we're finalizing the filter
						leadingElementPromise = AH.resolve(null);
					} else {
						leadingElementPromise = AH.resolve(this);
					}
				} else {
					leadingElementPromise = this.fetchElement(leadingReferences.join("."));
				}

				//
				// process the collection portion of the specifier
				//

				// look up the collection model for each reference
				var collectionModels = mapReferencesToModels(mergedCollectionReferences, leadingElementClass);

				// the target class of the collection is based off of the class type of the final collection's model
				var targetClass = collectionModels[collectionModels.length - 1].colClass;

				// process and generate the filter
				var logicalFilter = _.reduceRight(collectionModels, buildFilter, "");

				// prepend $ to denote string as logical filter
				logicalFilter = "$" + logicalFilter.substr(1) + " = "; // + leadingElement.id, once resolved

				// create the collection
				var newCollection = this._mdoCon.createCollection(targetClass.name);
				var filterParams = [];
				if (options.queryFilter) {
					logicalFilter = "(" + options.queryFilter + ") and " + logicalFilter;
					filterParams = options.args || filterParams;

					delete options.queryFilter;
					delete options.args;
				}

				// wait for the root element to resolve, and then finish building the logical filter
				return AH.when(leadingElementPromise, function (leadingElement) {
					// element is now resolved, so we can get the id
					// If the element didn't resolve, just use 0; this will create an empty collection,
					// but the collection will have the correct element type
					logicalFilter += ((leadingElement && leadingElement.id) || 0);
					newCollection.queryFilter(logicalFilter, filterParams);
					if (options.querySort) {
						newCollection.querySort(options.querySort);
						delete options.querySort;
					}
					// fetch the collection
					return newCollection.fetch(options);
				});

				//
				// Helper Functions
				//

				// find the index of the first collection (i.e., the first element with "[]" suffix)
				function findFirstCollectionIndex(refs, modelClass) {
					var colIndex = 0;
					for (; colIndex < refs.length && !refs[colIndex].match(/\[\]$/); colIndex++) {
						// look for the first non-element name. This will either be a collection, or an invalid
						// name. Invalid names are handled elsewhere, so here we just care that if it
						// might be the start of the merged collection, then we break and have the
						// correct index.
						var element = modelClass.allElements.getByName(refs[colIndex], false);
						if (!element) {
							break;
						} else {
							modelClass = element.refClass;
						}
					}
					return colIndex;
				}

				// fetches the class type of a given element on a model class
				function getElementClass(elementClass, nextElementName) {
					return elementClass.allElements.getByName(nextElementName, true).refClass;
				}

				// Given a leading class and the name of an collection, returns the model collection
				// that the element points to.
				function getCollectionModel(elementClass, collectionName) {
					return elementClass.allCollections.getByName(collectionName.replace(/\[\]$/, ""), true);
				}

				// given an array of collection names and a leading element class, returns an array
				// of model collections that correspond to the collection names
				function mapReferencesToModels(collectionReferences, elementClass) {
					var models = [];
					_.reduce(collectionReferences, function (leadingClass, collectionReference) {
						var collectionModel = getCollectionModel(leadingClass, collectionReference);
						models.push(collectionModel);
						return collectionModel.colClass;
					}, elementClass);
					return models;
				}

				// chains together the logical filter used to select the elements in the collection
				function buildFilter(filter, previousModelCollection) {
					return filter + "." + previousModelCollection.colParent.element.name;
				}

			}, this);
		},

		// ## getElement(name)

		/**
		@method getElement

		Returns an unfetched MDO.Element identified by `name`.

		@param {String} name

		Name identifying the model element to get.

		@returns {MDO.Element}

		Unfetched element of the appropriate type.
		Returns `null` if the element reference is `null` or `0`.

		@throws {Error}

		Fails if `name` is not a valid reference field.

		@throws {Error}

		Fails if given a merged reference field: {@link Constants.ErrorCode#mergedRefNotSupported mergedRefNotSupported}.

		@throws {Error}

		Fails if reference field is not fetched: {@link Constants.ErrorCode#refFieldNotFetched refFieldNotFetched}.

		### Usage:

			var mdoEltLocation = mdoElt.getElement("ahLocationRef");
			if(mdoEltLocation) {
				mdoEltLocation.fetch().then(...);
			}
		*/
		getElement: function (name) {
			// Merged references would fail the element name lookup anyways, but this
			// provides a much clearer error
			if (name.indexOf(".") > -1) {
				throw new MdoError("Merged references are not supported by getElement(): " + name, Constants.errorCodes.mergedRefNotSupported);
			}
			// get the appropriate field for the fkey
			var modelElt = this.mdoClass.allElements.getByName(name, true);
			var modelField = modelElt.referenceField;
			// validate fkey, or return `null` if the fkey doesn't provide a valid reference
			var fkey = this.get(modelField.name);
			if (fkey === undefined) {
				throw new MdoError("'" + name + "' could not be found because the '" + modelField.name + "' field was not fetched", Constants.errorCodes.refFieldNotFetched);
			}
			if (!fkey) {
				return null;
			}
			// build up target element
			var refClass = modelElt.refClass;
			var newElement = this._mdoCon.createElement(refClass.name);
			newElement.set(refClass.idField.name, fkey);
			return newElement;
		},


		// ## fetchElement(elementName)

		/**
		@method fetchElement

		Returns a {@link Promise} that resolves with a fetched MDO.Element identified by `name`.
		Alternatively, {@link MDO.Element#queryInclude} can be used to automatically retrieve referenced elements when calling {@link MDO.Element#fetch}.

		@param {String} name

		Name identifying the model element to fetch get.
		Name may contain merged references (e.g. "ahAssetRef.ahLocationRef")

		@returns {Promise.<MDO.Element>}

		Resolves with fetched element or `null` if element does not exist.

		@throws {Error}

		Fails if reference field is not fetched: {@link Constants.ErrorCode#refFieldNotFetched refFieldNotFetched}.

		@async

		### Usage:

			var mdoEltLocationPromise = mdoElt.fetchElement("ahLocationRef");
			mdoEltLocationPromise.then(function(mdoElt) {
				if(mdoElt) {
					...
				}
			}
		*/
		fetchElement: function (elementName) {
			return AH.deferredTryCatch(function () {
				// split up the element if it's a merged element
				var references = elementName.split(".");
				// iterate over all the components of a merged element, fetching each in turn
				return _.reduce(references, function (promise, nextElement) {
					return AH.when(promise, function (element) {
						// if one of the previous references failed to resolve, just return null
						// since all subsequent references can't exist
						if (element === null) {
							return null;
						}
						// Attempt to grab an unfetched element, and fetch it if it exists
						var newElement = element.getElement(nextElement);
						return newElement !== null ? newElement.fetch().then(null, fetchFail) : null;

						function fetchFail(error) {
							return error.message.match(/0 rows matched for/i) ? AH.resolve(null) : error;
						}

					});

				}, AH.resolve(this));

			}, this);
		},

		// ## _fetchRefs()
		//
		// Fetch element references specified using {queryInclude} and via `arrElementRefs`
		// and add them to this element.
		//
		// Returns Promise that resolves when all referenced elements have been fetched
		//
		_fetchRefs: function () {
			if (!this.includedRefs) {
				return this;
			}

			// Add self to a collection with same includeRefs
			var col = this.mdoConnection.createCollection(this.mdoClass.name);
			col.includedRefs = this.includedRefs;
			col.models.push(this);

			// Let the collection fetch our includedRefs
			return col._fetchRefs()
				.then(_.bind(_.identity, null, this));
		},

		/**
		 * @method queryInclude
		 * @chainable
		 *
		 * Add the specified `elementName` to this MDO.Element when {@link MDO.Element#fetch} or {@link
		 * MDO.Element#resolve} is called. If the Foreign Key is null or the Foreign Key is for an element that does not
		 * exist, then the attribute will be populated with `null`.
		 *
		 * Calling this method multiple times can include multiple element references.
		 *
		 * ### Usage:
		 *
		 *     var mdoUser = mdoCon.createElement("AH_User");
		 *     mdoUser.queryInclude("ahEmployeeRef")
		 *         .fetch()
		 *         .then(function(mdoElt) {
		 *             console.log(mdoElt.ahLogin + ": " + mdoElt.ahEmployeeRef.ahEmployee);
		 *         });
		 *
		 * @param {String} elementName
		 *
		 * Name of element reference to include.
		 * The name can be simple (e.g. `'ahSiteRef'`) or merged (e.g. `'ahSiteRef.ahLocationRef'`).
		 *
		 * @param {Object} [options]
		 *
		 * @param {Array} [options.fields=undefined (include all fields)]
		 *
		 * Names of fields to include when fetching referenced elements. If not specified, all fields will be fetched.
		 *
		 * @return {MDO.Element}
		 * Returns this element.
		 */

		/**
		 * @method idEquals
		 * Checks if two MDO.Element instances refer to the same element in the data store
		 *
		 * @param {MDO.Element} otherElement
		 * The element to compare against
		 *
		 * @returns {boolean} `true` if the elements refer to the same record in the data store
		 */
		idEquals: function(otherElement) {
			return Boolean(this && otherElement
					&& this.id && this._ds.store.resolveTempId(this.id) === this._ds.store.resolveTempId(otherElement.id)
					&& _.last(this.mdoClass.inheritance) === _.last(otherElement.mdoClass.inheritance));
		},

		/**
		 * @method sync
		 * @private
		 * @chainable
		 *
		 * Implements loading and saving element to the data store
		 *
		 * The following events are fired on the MDO.Connection which owns this element unless the `silent` option is
		 * specified:
		 *
		 * * {@link MDO.Connection#event-data_modified data_modified}: When an `update` sync completes
		 * * {@link MDO.Connection#event-data_added data_added}:  When an `create` sync completes
		 * * {@link MDO.Connection#event-data_deleted data_deleted}: When an `delete` sync completes
		 *
		 * @param {string} method
		 * The operation describing how this element should be synchronized (`read`, `update`, `create`, or `delete`)
		 *
		 * @param {MDO.Element} model
		 * The model being synchronized
		 *
		 * @param options
		 *
		 * @param {boolean} [options.silent=false]
		 * `true` causes the events fired on the MDO.Connection to be suppressed
		 *
		 * @return {Promise.<MDO.Element>}
		 */
		sync: function (method, model, options) {
			var ds = this._ds;
			var self = this;
			var deletedItems;

			var resolvedAttributes = this._syncAttributes(this.resolveTempIds(this.attributes));

			function onSuccess(resp) {
				// assignment of original attributes should
				// be called before the success callback
				self.originalAttributes = _.clone(resp);
				options.success(resp);
				self._state = Constants.elementStates.saved;
				return AH.resolve(self);
			}

			function onDeleteSuccess(resp) {
				deletedItems = resp;
				options.success(resolvedAttributes);
				self._state = Constants.elementStates.deleted;
				return AH.resolve(self);
			}

			function onError(err) {
				// Handle database out of memory errors
				AH.normalizeWebSqlError(err);
				if (options.error) {
					options.error(self, err, options);
				}
				return AH.reject(err);
			}

			switch (method) {
				case "read":
					// When options.resolve is true, fetch based on fields, otherwise based on ID
					return AH.deferredTryCatch(function () {
						var filter = options.resolve
							? this.mdoClass.getFieldFilter(resolvedAttributes)
							: this.mdoClass.getIdFilter(resolvedAttributes);

						return ds.store.getRow({
							className: this.mdoClass.name,
							filter: filter,
							queryOptions: { fields: options.fields }
						}).then(onSuccess, onError);
					}, this);

				case "update":
					// NOTE: This could be optimized by checking (this.mdoState == 'changed')
					return ds.store.updateElement(this.mdoClass, resolvedAttributes,
							this.resolveTempIds(this.originalAttributes), this._getLocalOnly(options.localOnly))
						.then(onSuccess, onError)
						.then(function() {
							self._mdoCon.onDataUpdated(Constants.connectionEvents.dataModified, self, options);
							return self;
						});

				case "delete":
					return ds.store.deleteElement(this.mdoClass, resolvedAttributes, Boolean(options.localOnly))
						.then(onDeleteSuccess, onError)
						.then(function () {
							self._mdoCon.onDataUpdated(Constants.connectionEvents.dataDeleted, deletedItems, options);
							return self;
						});

				case "create":
					return ds.store.insertElement(this.mdoClass, resolvedAttributes, this._getLocalOnly(options.localOnly))
						.then(onSuccess, onError)
						.then(function () {
							self._mdoCon.onDataUpdated(Constants.connectionEvents.dataAdded, self, options);
							return self;
						});

				default:
					return AH.reject(new Error("MDO.Element sync method not implemented: " + method));
			}
		},

		// ### _getLocalOnly (localOnly)
		//
		// Returns a combined localOnly value passed to Data/Store.
		//
		// If localOnly is true, returns true (all fields are local only)
		// Otherwise it combines the specified fields with this element's localOnlyFields.
		//
		_getLocalOnly: function (localOnly) {
			if (localOnly === true) {
				return true;
			}

			if (_.isArray(localOnly)) {
				return this.localOnlyFields
					? localOnly.concat(this.localOnlyFields)
					: localOnly;
			}

			return this.localOnlyFields;
		},

		/**
		 * Returns true if the given attributeName is a reference
		 *
		 * @param {string} fieldName
		 * The name of the field to check
		 *
		 * @returns {boolean}
		 * true if the given attributeName is a reference
		 *
		 * @private
		 */
		_isReference: function (fieldName) {
			var field = this.mdoClass.allFields.getByName(fieldName);
			return field && field.element;
		},

		// ### resolveTempIds (attributes)
		//
		// Resolves all tempids in the attributes. Does not modify the original values.
		//
		// Returns a lookup of the given attributes with all tempids resolved
		//
		resolveTempIds: function (attributes) {
			var resolved = {};
			Object.keys(attributes).forEach(_.bind(function (key) {
				if (key === this.idAttribute || this._isReference(key)) {
					resolved[key] = this._ds.store.resolveTempId(attributes[key]);
				} else {
					resolved[key] = attributes[key];
				}
			}, this));
			return resolved;
		},

		// ### _syncAttributes (attributes)
		//
		// Modifies which attributes are going to be processed during sync operation.
		//
		// Returns attributes to be synced
		//
		_syncAttributes: function (attributes) {
			return attributes;
		}
	});

	// Add mixins
	_.extend(MdoElement.prototype, QueryIncludeMixin);

	/**
	 * @property {DataModel.Class} mdoClass
	 * @readonly
	 *
	 * This element's model class.
	 */
	Object.defineProperty(MdoElement.prototype, "mdoClass", {
		get: function () { return this._class; }
	});

	/**
	 * @property {MDO.Connection} mdoConnection
	 * @readonly
	 *
	 * The MDO.Connection for which this element was created.
	 */
	Object.defineProperty(MdoElement.prototype, "mdoConnection", {
		get: function () { return this._mdoCon; }
	});

	/**
	 * @property {Constants.ElementState} mdoState
	 * @readonly
	 *
	 * Current state of the mdo element.
	 */
	Object.defineProperty(MdoElement.prototype, "mdoState", {
		get: function () { return this._state; }
	});

	/**
	 * @property {number} id
	 *
	 * The element's primary key in the database.
	 */

	/**
	 * @event change
	 * Fired whenever a field on the element changes, such as with #set or directly setting a property; This event may
	 * be suppressed if the `silent` option is passed to #set. If multiple fields are updated with a single
	 * call to #set, then this event will only fire once.
	 *
	 * To watch for individual field updates, listen for the `change:{fieldName}` event, where `{fieldName}` is the
	 * case-correct name of the field to watch. These events are fired for every update to a field, and contain a
	 * `previousValue` as the second parameter which contains the value of the field prior to the update (`options` is
	 * the 3rd parameter on these events).
     *
     * ## Example
     *
     *     var element = mdoCon.createElement("AH_WorkOrder");
     *     element.ahStatus = "ACTIVE"; // initial state
     *     element.ahAsset  = "12345";  // initial state
     *
     *     element.on("change", function(element, options) { console.log(element.toString() + " was changed!"); });
     *     element.on("change:ahStatus", function(element, previousValue, options) {
     *         console.log("ahStatus changed from " + previousValue + " to " + element.ahStatus);
     *     });
     *     element.on("change:ahAsset", function(element, previousValue, options) {
     *         console.log("ahAsset is now " + element.ahStatus);
     *     });
     *
     *     element.set({ ahStatus: "COMPLETED", ahAsset: null}); // Will cause the following to print:
     *     // AH_WorkOrder{} was changed!
     *     // ahAsset is now null
     *     // ahStatus changed from ACTIVE to COMPLETED
	 *
	 * @param {MDO.Element} element
	 * The MDO.Element that was changed
	 *
	 * @param {Object} options
	 * The options that were passed to #set; When an element is modified with a property setter, only the `validate`
	 * is specified (as `true`).
	 */

	/**
	 * @event sync
	 * Fires whenever this element's fields are synchronized with the datastore during a #save, #destroy, or #fetch
	 * operation
	 *
	 * @param {MDO.Element} element
	 * The MDO.Element that was synchronized
	 *
	 * @param {*} response
	 * The datastore's response to the synchronization
	 *
	 * @param {Object} options
	 * The options that were passed to the method which synchronized this MDO.Element.
	 */

	/**
	 * @event destroy
	 * Fired when this element is being destroyed as a result of #destroy.
	 *
	 * @param {MDO.Element} element
	 * The MDO.Element that was destroyed
	 *
	 * @param {MDO.Collection} collection
	 * The collection which holds this element; otherwise `null` if this element is not a part of a collection
	 *
	 * @param {Object} options
	 * The options passed to #destroy
	 *
	 * @param {boolean} [options.wait=false]
	 * If `true`, then this event was not fired until after the element is removed from the datastore; otherwise, this
	 * event fires immediately.
	 */

	return MdoElement;

});
// MDO/FileElement
//
define('MDO/FileElement',[
	"underscore",
	"AH",
	"Constants",
	"Logging/logger",
	"./Element",
	"Files/fileSystem",
	"./Error"
], function (
	_,
	AH,
	Constants,
	logger,
	MdoElement,
	fs,
	MdoError
	) {

	"use strict";

	/**
	 * @class MDO.FileElement
	 * @extends MDO.Element
	 *
	 * A single, strongly typed record in the M-Tier datastore with an attached file.
	 *
	 * Created via {@link MDO.Connection#createElement}.
	 *
	 * A File Element is an instance of a {@link DataModel.Class Model Class} whose type is "FileClass" or who has a parent class of type "FileClass".
	 *
	 * FileElement extends the standard {@link MDO.Element Element} behavior with the ability to attach a single file to the element.
	 *
	 * ### Working with FileElements
	 *
	 * #### Attaching a File object:
	 *
	 * If an `"Attachment"` Model.Class of type "FileClass" exists and a File object is obtained from an HTML &lt;input type="file"&gt; tag,
	 * the file can be attached to a FileElement like so:
	 *
	 *     // Get the file from the input tag
	 *     var file;
	 *     ...
	 *
	 *     // Create a FileElement
	 *     var mdoEltAttachment = mdoCon.createElement("Attachment");
	 *
	 *     // Attach the file
	 *     mdoEltAttachment.setFile(file);
	 *
	 *     // Save the element
	 *     mdoEltAttachment.save();
	 *
	 * By default, the FileElement's attachment will have the same name as the File being attached.
	 * However, #setFile supports a second parameter that allows an alternative filename to be specified.
	 *
	 *     // Attach the file
	 *     mdoEltAttachment.setFile(file, "picture.png");
	 *
	 *     // Save the element
	 *     mdoEltAttachment.save();
	 *
	 * In the example above, the `file` was "attached" to the FileElement and given the filename `picture.png`.
	 *
	 * #### Attaching a Blob object:
	 *
	 * Attaching a Blob object to a FileElement is very similar to attaching a File object, but because Blob objects
	 * don't have a filename property, a filename **has** to be specified when calling #setFile.
	 *
	 *     // Create a simple Blob with some text data
	 *     var blob = new Blob(['Hello World'], { type: 'text/plain' });
	 *     ...
	 *
	 *     // Create a FileElement
	 *     var mdoEltAttachment = mdoCon.createElement("Attachment");
	 *
	 *     // Attach the Blob, with a required filename
	 *     mdoEltAttachment.setFile(blob, "HelloWorld.txt");
	 *
	 *     // Save the element
	 *     mdoEltAttachment.save();
	 *
	 */
	var MdoFileElement = MdoElement.extend({

		// Array of field names that we do not want to include in MTL Xacts generated on the client
		localOnlyFields: [
			"ahLastDownloadTS",
			"ahDownloadVersion",
			"ahFilePath",
			"ahSourcePath"
		],

		// ### sync (method, model, options)
		//
		// Implements loading and saving element to the data store
		//
		// Returns a promise that resolves when the operation is completed
		//
		sync: function (method, model, options) {
			var self = this;
			var args = arguments;
			var syncEltPromise;

			return syncElement()
				.then(syncVault)
				.then(function () {
					return syncEltPromise;
				});

			function syncElement() {
				syncEltPromise = MdoElement.prototype.sync.apply(self, args);

				return syncEltPromise;
			}

			function syncVault() {
				var vaultPromise;

				switch (method) {
					case "create":
						vaultPromise = addVaultFile();
						break;
					case "update":
						// The _fileData is a local file or download from the server
						if (self._fileData) {
							vaultPromise = addVaultFile();
						}
						break;
					case "delete":
						vaultPromise = removeVaultFile();
						break;
					case "read":
						break;
					default:
						throw new Error("Invalid sync method: " + method);
				}

				return AH.when(vaultPromise)
					.then(function () {
						delete self._fileData;
						delete self._fileVersion;
						delete self._fileDownloadTs;
					});
			}

			function addVaultFile() {
				return self._ds.vault.addFile(self._fileData, self.mdoClass, self.ahFileName)
					.then(null, function (vaultError) {
						var error = new Error("Failed to save file attachment to the vault. The element may be in an inconsistent state.");
						error.exception = vaultError;

						return AH.reject(error);
					});
			}

			function removeVaultFile() {
				return self._ds.vault.removeFile(self.mdoClass, self.ahFileName, true);
			}
		},

		// ### _syncAttributes (attributes)
		//
		// If necessary, adds `ahLocalVersion`, `ahCurrentUploadTS` and `ahLastDownloadTS` to attributes
		// to be saved to database.
		//
		// Returns attributes to be synced
		//
		_syncAttributes: function (attributes) {
			if (this._fileVersion) {
				attributes.ahLocalVersion = this._fileVersion;
			}

			if (this._fileDownloadTs) {
				attributes.ahLastDownloadTS = this._fileDownloadTs;
				attributes.ahCurrentUploadTS = null;
			} else if (this._fileData) {
				attributes.ahCurrentUploadTS = new Date();
			}
			return attributes;
		},

		save: function () {
			var self = this;
			var args = arguments;

			return rejectIfCreateEltWithoutFile()
				.then(rejectIfCreateEltWithoutFilename)
				.then(rejectIfCreateWithDuplicateFilename)
				.then(function () {
					return MdoElement.prototype.save.apply(self, args);
				});

			function rejectIfCreateEltWithoutFile() {
				if (self.isNew() && !self._fileData) {
					var error = new Error("Cannot save a new element without first attaching a file. Make sure to call 'setFile'.");

					return AH.reject(error);
				}

				return AH.resolve();
			}

			function rejectIfCreateEltWithoutFilename() {
				if (self.isNew() && !self.ahFileName) {
					return AH.reject(new MdoError("Cannot save a new element without specifying a file name.", Constants.errorCodes.fileNameMissing));
				}

				return AH.resolve();
			}

			// This check is necessary because we don't yet have support for
			// TUIDs, so uniqueness isn't guaranteed at the database level
			//
			// NOTE: Once TUIDs are implemented, we can remove this method and all calls to it.
			//
			function rejectIfCreateWithDuplicateFilename() {
				if (!self.isNew()) {
					return false;
				}

				var db = self._ds.store.database;
				var sql = "SELECT COUNT(*) as count FROM " + self.mdoClass.name + " WHERE ahFileName = ?";

				return db.read(sql, [self.ahFileName])
					.then(function (rs) {
						var result = rs.rows.item(0).count;

						if (result > 0) {
							return AH.reject(new MdoError("An element with an 'ahFileName' of '" + self.ahFileName + "' already exists.", Constants.errorCodes.fileNotUnique));
						}
					});
			}
		},

		/**
		 * @method setFile
		 * @chainable
		 *
		 * Attaches a file to the FileElement.
		 * This method **must** be called before a new FileElement can be saved.
		 * After the element has been saved, its file attachment can be retrieved using #getFile.
		 *
		 * ## Basic Usage:
		 *
		 *     // Get the file from the input tag
		 *     var file;
		 *     ...
		 *
		 *     // Create a FileElement
		 *     var mdoEltAttachment = mdoCon.createElement("Attachment");
		 *
		 *     // Attach the file
		 *     mdoEltAttachment.setFile(file);
		 *
		 *     // Save the element
		 *     mdoEltAttachment.save();
		 *
		 * @param {File/Blob} data
		 * The data to be attached when the element is saved.
		 *
		 * @param {String} [filename]
		 * The filename of the attachment.
		 *
		 * If `filename` is specified and the element is new, then the filename will be updated.
		 * If a new `filename` is specified and the element exists, then an error will be thrown.
		 *
		 * @return {MDO.FileElement}
		 * Returns this element.
		 *
		 * @throws {Error}
		 * If `filename` is specified for an existing element, but not the same as the recorded filename, then
		 * a {@link Constants.ErrorCode#notSupported notSupported} Error is thrown.
		 *
		 */
		setFile: function (data, filename) {

			if (!data) {
				throw new MdoError("'data' must be specified.", Constants.errorCodes.invalidArgs);
			}

			if (filename && !_.isString(filename)) {
				throw new MdoError("'filename' must be a valid string.", Constants.errorCodes.invalidArgs);
			}

			if (filename && filename !== this.ahFileName && !this.isNew()) {
				throw new MdoError("Cannot change file name on an existing element.", Constants.errorCodes.notSupported);
			}

			if (!(data instanceof Blob)) {
				throw new MdoError("'data' is of an unsupported type.", Constants.errorCodes.notSupported);
			}

			if (filename) {
				this.ahFileName = filename;
			}

			// Only assign user provided file info if it passes all validation
			this._fileData = data;


			/**
			 * @event file_set
			 *
			 * A file was attached to the FileElement.
			 *
			 * ## Usage:
			 *
			 *		mdoFileElt.on(Constants#dataEvents.{@link Constants.DataEvent#fileSet fileSet}, function(file) {
			 *			alert('A file has been selected!');
			 *		});
			 *
			 * @param {Blob} file
			 * the file data for the new file
			 */
			this.trigger(Constants.dataEvents.fileSet, this._fileData);

			// Delete fileVersion in case downloadFile() was previously called.
			delete this._fileVersion;
			delete this._fileDownloadTs;

			return this;
		},

		/**
		 * Helper method that determines if a given field should be read-only. For `FileElements`, the `ahSourcePath` and
		 * `ahFilePath` fields are read-only. The `ahFileName` field is also read-only after a `FileElement` is committed to the
		 * database.
		 *
		 * @param {DataModel.Field} field
		 * The field to check
		 *
		 * @returns {boolean}
		 * Flag indicating if the field is read-only or not.
		 *
		 * @private
		 */
		_isReadOnlyField: function (field) {
			switch (field.name) {
				case "ahFileName":
					return !this.isNew();
				case "ahSourcePath":
				case "ahFilePath":
					return true;
				default:
					return false;
			}
		},

		/**
		* @method getFile
		*
		* Returns a {@link Promise} that resolves with the element's attached data.
		*
		* ## Basic Usage:
		*
		*     // Get the saved attachment
		*     mdoFileElt.getFile().then(function(blob) {
		*         // Do something with the Blob
		*     });
		*
		* @returns {Promise.<Blob>}
		*
		* Resolves with the attached data.
		*
		* @async
		*/
		getFile: function () {
			if (this._fileData) {
				return AH.resolve(this._fileData);
			} else if (this.isNew()) {
				return AH.resolve(null);
			} else if (this.hasLocalFile) {
				return this._ds.vault.getFile(this.mdoClass, this.ahFileName);
			}

			return AH.reject(new MdoError("The file '" + this.ahFileName + "' cannot be retrieved because it has not been downloaded", Constants.errorCodes.fileNotDownloaded));
		},

		/**
		* @method getFileDataUrl
		*
		* Returns a {@link Promise} that resolves with the element's attached data as a data url.
		*
		* ## Basic Usage:
		*
		*     // Get the saved attachment
		*     mdoFileElt.getFileDataUrl().then(function(dataUrl) {
		*         // Use data url to display attachment data
		*     });
		*
		* @returns {Promise.<String>}
		*
		* Resolves with the data url representation of the attached data (e.g. "data:image/gif;base64,SGVsbG8g...V29ybGQ=").
		*
		* @async
		*/
		getFileDataUrl: function () {
			return this.getFile()
				.then(function (file) {
					if (file === null) {
						return file;
					}
					return readBlobAsDataURL(file);
				});

			function readBlobAsDataURL(blob) {
				var dfd = AH.defer();

				var reader = new FileReader();

				reader.onerror = function (error) {
					dfd.reject(error);
				};

				reader.onloadend = function (evt) {
					dfd.resolve(evt.target.result);
				};

				reader.readAsDataURL(blob);

				return dfd.promise;
			}
		},

		/**
		 * @method downloadFile
		 *
		 * Download the file attachment from the server.
		 *
		 * Returns a {@link Promise} that resolves with the downloaded file.
		 *
		 * ## Basic Usage:
		 *
		 *     // Download attachment without saving it locally
		 *     mdoFileElt.downloadFile().then(function(blob) {
		 *         // Do something with the downloaded blob
		 *     });
		 *
		 *     // Download and save attachment
		 *     mdoFileElt.downloadFile()
		 *         .then(function(data){
		 *             return mdoFileElt.save();
		 *         });
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before the download is considered to have timedout.
		 *
		 * @returns {Promise.<Blob>}
		 *
		 * Resolves with the attached data.
		 *
		 * @async
		 */
		downloadFile: function (timeout) {

			// We cannot download a file on an element that hasn't been fetched.
			if (this.mdoState === Constants.elementStates.new) {
				return AH.reject(new MdoError("Cannot call downloadFile() on an unfetched element", Constants.errorCodes.fileElementIsNew));
			}

			var self = this;

			self._logMessage("Downloading attachment '" + self.ahFileName + "'...");

			var promise = this._downloadFileFromServer(timeout).then(function (fileInfo) {
				// Assign private _fileData and _fileVersion
				var fileData = AH.createBlob(fileInfo.contents, fs.getMimeType(self.ahFileName));
				self._fileData = fileData;
				self._fileVersion = fileInfo.version;
				self._fileDownloadTs = new Date();

				// Resolve with file contents
				return fileData;
			});

			return promise.tap(function () {
				self._logMessage("Downloaded attachment '" + self.ahFileName + "' (" + self._fileData.size + " bytes, version " + self._fileVersion + ")");
			});
		},

		_downloadFileFromServer: function (timeout) {
			var fileServer = this.mdoConnection._internal.getFileServer();

			return fileServer.downloadFile({
				datastore: this._ds.dsInfo.name(),
				fileClass: this.mdoClass.name,
				fileName: this.ahFileName,
				id: this.PKey,
				timeout: timeout
			});
		},

		/**
		 * @method uploadFile
		 *
		 * Upload the file attachment from the server.
		 *
		 * Returns a {@link Promise} that resolves when the upload completes and changes are committed to database.
		 *
		 * ## Basic Usage:
		 *
		 *     // Create file element, set attachment and upload to server
		 *     var mdoFileElt = mdoCon.createElement(...);
		 *     return mdoFileElt.setFile(...)
		 *        .then(function() {
		 *            return mdoFileElt.save();
		 *         })
		 *        .then(function() {
		 *             return mdoFileElt.uploadFile();
		 *         });
		 *
		 * @param {number} [timeout=120000]
		 * Duration in milliseconds to wait before the upload is considered to have timedout.
		 *
		 * @returns {Promise.<MDO.FileElement>}
		 *
		 * Resolves with the {MDO.FileElement}.
		 *
		 * @async
		 */
		uploadFile: function (timeout) {

			// We cannot upload a file on an element that hasn't been fetched.
			if (this.mdoState === Constants.elementStates.new) {
				return AH.reject(new MdoError("Cannot call uploadFile() on an unfetched element", Constants.errorCodes.fileElementIsNew));
			}

			// We cannot upload a file on an element that hasn't been fetched.
			if (this.mdoState === Constants.elementStates.changed) {
				return AH.reject(new MdoError("Cannot call uploadFile() on an unsaved element", Constants.errorCodes.fileElementNotSaved));
			}

			// We cannot upload a file on an element that doesn't have local modifications.
			if (!this.ahCurrentUploadTS) {
				return AH.reject(new MdoError("Cannot call uploadFile() on an element without changed attachment", Constants.errorCodes.fileElementNoChanges));
			}

			// We cannot upload a file with pending attachment.
			if (this._fileData) {
				return AH.reject(new MdoError("Cannot call uploadFile() on an unsaved element", Constants.errorCodes.fileElementNotSaved));
			}

			var self = this;

			return this.getFile()
				.then(uploadFile)
				.then(commitFileUpload)
				.tap(function () {
					self._logMessage("Uploaded attachment '" + self.ahFileName + "' (version " + self.ahLocalVersion + ")");
				});

			function uploadFile(contents) {
				self._logMessage("Uploading attachment '" + self.ahFileName + "' (" + contents.size + " bytes)...");
				var fileServer = self.mdoConnection._internal.getFileServer();
				return fileServer.uploadFile({
					datastore: self._ds.dsInfo.name(),
					fileClass: self.mdoClass.name,
					fileName: self.ahFileName,
					lastModified: self.ahCurrentUploadTS,
					id: self.PKey,
					timeout: timeout
				}, contents);
			}

			function commitFileUpload(fileInfo) {
				self.ahLocalVersion = fileInfo.version;
				self._fileDownloadTs = new Date();
				self.ahCurrentUploadTS = null;

				return self.save();
			}

		},

		/**
		 * @method _logMessage
		 * @private
		 * Uses the logger to log a message with the datastore's Id
		 *
		 * @param {string} message
		 *
		 * @param {Object} [options]
		 *
		 * @return {Promise}
		 * Resolves when the message has been logged
		 */
		_logMessage: function (message, options) {
			logger.log(message, _.extend({
				domainId: this._ds.dsInfo.id(),
				category: "INFO"
			}, options));
		}
	});

	Object.defineProperties(MdoFileElement.prototype, {
		/**
		@property {Boolean} hasLocalFile
		@readonly

		Returns true if the element's attachment exists locally.
		*/
		hasLocalFile: {
			get: function () {
				return Boolean(this._fileData) // has a pending attachment
					|| AH.isDefined(this.ahLocalVersion) // has downloaded an attachment from the server
					|| AH.isDefined(this.ahCurrentUploadTS); // has a pending attachment upload
			}
		}
	});

	return MdoFileElement;
});
// MDO/Collection
//

define('MDO/Collection',[
	"AH",
	"underscore",
	"backbone",
	"./QueryIncludeMixin"
], function (
	AH,
	_,
	Backbone,
	QueryIncludeMixin
	) {

	"use strict";

	/**
	 * @class MDO.Collection
	 * Collection of MDO.Element records in the M-Tier datastore.
	 *
	 * Created via {@link MDO.Connection#createCollection}.
	 */
	var MdoCollection = Backbone.Collection.extend({

		// ## Initialize an instance of an MDO collection
		//
		// Sets initial attributes and `className`
		//
		initialize: function (models, options) {
		},

		/**
		 * @method toString
		 *
		 * Return a string consisting of the class name and {@link #length}, e.g. `AH_User[5]`.
		 *
		 * @returns {string}
		 */
		toString: function() {
			return this.mdoClass.name + "[" + this.length + "]";
		},

		/**
		 * @method fieldValueToDb
		 *
		 * Converts a JavaScript value to the representation expected by the database.
		 *
		 * ## Usage:
		 *
		 *      var mdoCol = mdoCon.createCollection("AH_WorkJournal");
		 *
		 *      mdoCol.queryFilter("$ahStartTs > ?", [ mdoCol.fieldValueToDb("ahStartTs", date) ]);
		 *
		 * @param {String} fieldInfo
		 *
		 * *FieldName* string identifying the model field to use for the conversion.
		 *
		 * @param {*} value
		 *
		 * Value to be converted.  The `value`'s data type must match the specified `fieldInfo`.
		 *
		 * @returns {*}
		 *
		 * Value in the representation expected by the database.
		 *
		 * @throws {Error}
		 *
		 * Fails if an invalid `fieldInfo` or a type-incompatible `value` is specified.
		 */
		fieldValueToDb: function(fieldInfo, value) {
			// We support both "Class.Field" as well as "Field"
			var chunks = fieldInfo.split(".", 2);
			var modelClass = chunks.length === 2
				? this.mdoClass.model.classes.getByName(chunks.shift(), true)
				: this.mdoClass;
			var modelField = modelClass.allFields.getByName(chunks.shift(), true);
			return modelField.valueToDb(value);
		},

		/**
		 * @method queryFilter
		 * @chainable
		 *
		 * Specifies the collection filter using a logical string filter, or a plain JavaScript object or an MDO.Element instance.
		 *
		 * When {@link MDO.Collection#fetch} is subsequently called, only records matching the specified filter are returned.
		 *
		 * Note: Use the {@link MDO.Collection#filter} method to filter fetched elements.
		 *
		 * ## Usage:
		 *
		 * {@link MDO.Collection#queryFilter} can take in three different parameter types. The following examples are all equivalent:
		 * ###Supported Parameter Types
		 * `queryFilter(logicalString,parameters)` - String is an SQL expression,  parameters is an array of fields:
		 *
		 *      mdoCol.queryFilter("$ahLogin=?", ["Bob"])
		 *
		 * `queryFilter(Object)` - The filter matches the values for each property in the object.
		 *
		 *      mdoCol.queryFilter({ahLogin:"Bob"})
		 *
		 * `queryFilter(MDO.Element)` - The filter matches against the MDO.Element's fields.
		 *
		 *      var mdoElt = mdoCon.createElement("AH_User");
		 *      mdoElt.ahLogin = "Bob";
		 *      mdoCol.queryFilter(mdoElt);
		 *
		 *
		 * ### Advanced:
		 *
		 * The filter can use any SQL that's valid in a SQLite WHERE clause:
		 *
		 *      mdoCol.queryFilter("$ahLogin LIKE ? OR $ahLogin IN (?, ?, ?)",
		 *          ["B%", "Larry", "Moe", "Curley"]);
		 *
		 * Timestamp parameters should be normalized using the {@link MDO.Collection#fieldValueToDb} method:
		 *
		 *      var expectedDate = new Date();
		 *      mdoCol.queryFilter("$ahExpectedTs < ?", [ mdoCol.fieldValueToDb( "ahExpectedTs", expectedDate ) ] );
		 *
		 * @param {string|Object|MDO.Element} filter
		 *
		 * Parameterized SQL filter which may contain logical fields (e.g. `$ahLogin` or `$ahLocationRef.ahZip`).
		 * Can be passed in as a string, object, or MDO.Element
		 *
		 * @param {Array} [filterParams]
		 *
		 * Array of parameters referenced from a string `filter`.
		 *
		 * Not used if `filter` paramter is of type object or MDO.Element
		 *
		 * **Note:** Use the {@link MDO.Collection#fieldValueToDb} method to convert parameter values to the representation
		 * expected by the database.
		 *

		 *
		 * @throws {Error}
		 *
		 * Fails if invalid parameters or filter fields are specified i.e. if the `filter` parameter is an Object,
		 * and `filterParams` is also passed in.
		 *
		 * @return {MDO.Collection}
		 *
		 * Returns this collection.
		 *
		 * Note, however, that specifying invalid SQL will _not_ fail this operation.
		 *
		 */
		queryFilter: function (filter, filterParams) {
			if (!_.isString(filter) && filterParams) {
				throw new Error("Cannot use 'filter params' array with object based queryFilter");
			}

			if (filter && filter.attributes) {
				filter = filter.attributes;
			}

			this._filter = filter;
			this._filterParams = filterParams;
			return this;
		},

		// ## fetchCount()

		/**
		 * @method fetchCount
		 *
		 * Returns the number of records matched by the collection's {@link MDO.Collection#queryFilter}.
		 *
		 * ## Usage:
		 *
		 * Display the number of records matching a query filter.
		 *
		 *     var mdoCol = mdoCon.createCollection("AH_User");
		 *     mdoCol.queryFilter("$ahLogin LIKE ?", ["B%"]);
		 *
		 *     mdoCol.fetchCount().then(function(count) {
		 *         alert(count + " logins start with B");
		 *     });
		 *
		 * @param {Object} options
		 *
		 * @param {boolean} [options.fromServer=false]
		 * Fetch data from the server instead of local datastore.
		 *
		 * @param {number} [options.timeout=120000]
		 * If fromServer is true, the duration, in milliseconds, for the request to wait before it is considered to have timed-out.
		 *
		 * @returns {Promise.<Number>}
		 * Resolves with the number of records.
		 *
		 * @async
		 */
		fetchCount: function(options) {
			return this._ds.getCount(_.extend({}, options, {
				className: this.mdoClass.name,
				filter: this._filter,
				filterParams: this._filterParams
			}));
		},

		// ## querySort(string)

		/**
		 * @method querySort
		 * @chainable
		 *
		 * Specifies the sort order of the elements in the collection via a sql-like _order by_ string.
		 * When calling `fetch` on a collection with an order by statement, the records will be returned in the specified sort order.
		 *
		 * Note: Use the {@link MDO.Collection#sortBy} method to sort fetched elements in memory.
		 *
		 * @param {String} order
		 *
		 * @return {MDO.Collection}
		 *
		 * Returns this collection.
		 *
		 * SQL order which may contain logical fields (e.g. `$ahLogin DESC, $ahLocationRef.ahZip ASC`).
		 */
		querySort: function (order) {
			this._order = order;
			return this;
		},

		/**
		 * @method queryInclude
		 * @chainable
		 *
		 * Add the specified `elementName` to the {@link MDO.Element Elements} in this MDO.Collection when {@link MDO.Collection#fetch} is called. If the Foreign Key
		 * is null or the Foreign Key is for an element that does not exist, then the attribute will be populated with 'null'.
		 *
		 * Calling this method multiple times can include multiple element references.
		 *
		 * @param {String} elementName
		 *
		 * Name of element reference to include.
		 * The name can be simple (e.g. `'ahSiteRef'`) or merged (e.g. `'ahSiteRef.ahLocationRef'`).
		 *
		 * @param {Object} [options]
		 *
		 * @param {Array} [options.fields=undefined (include all fields)]
		 *
		 * Names of fields to include when fetching referenced elements. If not specified, all fields will be fetched.
		 *
		 * @return {MDO.Collection}
		 *
		 * Returns this collection.
		 *
		 * ## Usage:
		 *
		 *      var mdoUserCol = mdoCon.createCollection("AH_User");
		 *      mdoUserCol
		 *          .queryInclude("ahEmployeeRef")
		 *          .queryInclude("ahSiteRef.ahLocationRef", { fields: [ "ahAddress" ] } )
		 *          .fetch()
		 *          .then(function(mdoCol) {
		 *				mdoCol.forEach(function(mdoElt) {
		 *					console.log(mdoElt.ahLogin + ": " + mdoElt.ahEmployeeRef.ahEmployee);
		 *					console.log("  " + mdoElt.ahSiteRef.ahLocationRef.ahAddress);
		 *				});
		 *		});
		 *
		 */

		/**
		 * @method fetch
		 *
		 * Loads the collection from the database (based on its {@link MDO.Collection#queryFilter}).
		 * If the collection contains elements that have been modified, they will be preserved based
		 * on the `reset` option parameter. Use the {@link MDO.Collection#queryInclude} method to automatically fetch referenced
		 * elements when the collection is fetched.
		 *
		 * @param {Object} options
		 *
		 * @param {boolean} [options.reset=false]
		 * Overwrite modified collection elements
		 *
		 * @param {number} [options.limit=no limit]
		 * Limit the number of records fetched.
		 *
		 * @param {number} [options.offset=0]
		 * Skip the specified number of records when fetching.
		 *
		 * @param {String[]} [options.fields=undefined]
		 * Names of fields to include in the fetch. If undefined, all fields will be fetched.
		 *
		 * @param {boolean} [options.fromServer=false]
		 * Fetch data from the server instead of local datastore.
		 *
		 * @param {boolean} [options.totalCount=false]
		 * Set the {@link #totalCount} property when fetching data.
		 * Useful when `limit` or `offset` are specified but the total (unlimited) number of records is also needed.
		 *
		 * @param {number} [options.timeout=120000]
		 * If fromServer is true, the duration, in milliseconds, for the request to wait before it is considered to have timed-out.
		 *
		 * @param {boolean} [options.silent=false]
		 * Set to `true` to suppress the {@link #event-remove remove} and {@link #event-add add} events from being fired
		 *
		 * @returns {Promise.<MDO.Collection>}
		 * Resolves with this collection when the fetch operation completes.
		 *
		 * @async
		 *
		 * @fires add
		 * @fires remove
		 * @fires sync
		 */

		fetch: function(options) {
			var self = this, refOptions;

			if (options && options.fromServer) {
				refOptions = _.pick(options, "fromServer", "timeout");
				return this.mdoConnection.withServerSession(fetchCollectionData);
			}

			return fetchCollectionData();

			function fetchCollectionData() {
				// MdoElement performs validation on every call to 'set', so we need to explicitly
				// disable validation during a fetch
				var promise = Backbone.Collection.prototype.fetch.call(self, _.extend({ validate: false },
					self._getFetchOptions("", options)));

				return self.includedRefs
					? promise.then(_.bind(self._fetchRefs, self, refOptions))
					: promise;
			}
		},


		/**
		 * @method destroyAllElements
		 *
		 * Deletes all records in this collection and any dependent records from the database (based on its {@link MDO.Element#id}). These changes
		 * will be propagated to the M-Tier server and other devices upon the next successful {@link MDO.Connection#sync sync}.
		 *
		 * ## Usage:
		 *
		 *     mdoCol.destroyAllElements();
		 *
		 * ## Local-only:
		 *
		 * By default, the destroy operation will be applied to the server and distributed to other clients during the next
		 * {@link MDO.Connection#sync sync}.
		 * Use the `localOnly` option to prevent the delete operation from being propagated to the server:
		 *
		 *     mdoCol.destroyAllElements({ localOnly: true });
		 *
		 * ## Wait:
		 *
		 * By default, elements will not be removed from the collection until they are successfully destroyed. To eagerly remove
		 * elements from the collection, set the 'wait' option to false.
		 *
		 *     mdoCol.destroyAllElements({ wait: false });
		 *
		 * This will remove the elements from the device's local database, but not on the server or other devices' databases.
		 *
		 * @param {Object} [options]
		 * A map of options to control how this MDO.Collection is deleted.
		 *
		 * @param {boolean} [options.localOnly=false]
		 * `true` if no transactions should be generated for this update; The changes made to this collection
		 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs.
		 *
		 * @param {boolean} [options.wait=true]
		 * If true, elements will not fire the {@link MDO.Element#event-destroy destroy} event until after the destroy
		 * is successful. This allows for elements whose destroy failed to remain in the collection.
		 *
		 * @param {boolean} [options.silent=false]
		 * `true` will cause the {@link MDO.Connection#event-data_deleted data_deleted} and
		 * {@link #event-remove remove} events for each element to be suppressed.
		 *
		 * @returns {Promise.<MDO.Collection>}
		 * Resolves when all records in the collection have been deleted from the database.
		 *
		 * @async
		 *
		 * @fires remove
		 */
		destroyAllElements: function(options) {
			options = _.extend({ wait: true }, options);

			var promises = _.map(this.toArray(), function(elt) {
				return elt.destroy(options);
			});

			return AH.whenSettle(promises)
				.then(function () { return AH.whenAll(promises); })
				.yield(this);
		},

		/**
		 * @method saveAllElements
		 *
		 * Saves all records in this collection to the database.  After saving a new element, its {@link MDO.Element#id}
		 * will be set to a unique value.
		 *
		 * ## Basic Usage:
		 *
		 * The following are equivalent:
		 *
		 *     var promises = [];
		 *     for(var index = 0; index < mdoCol.length; index++){
		 *          var mdoElt = mdoCol.at(index);
		 *          mdoElt.ahStatus = "ACTIVE";
		 *          promises.push(mdoElt.save());
		 *     }
		 *
		 *     for(var index = 0; index < mdoCol.length; index++){
		 *          mdoCol.at(index).ahStatus = "ACTIVE";
		 *     }
		 *     mdoCol.saveAllElements();
		 *
		 * ## Local-only:
		 *
		 * By default, changes to fields that applied during the save operation are also applied to the server and
		 * distributed to other clients during the next {@link MDO.Connection#sync sync} operation. Use the `localOnly`
		 * option to prevent the field changes to be applied to the server:
		 *
		 *     mdoCol.at(0).ahStatus = "ACTIVE";
		 *     ...
		 *     mdoCol.saveAllElements({ localOnly: true });
		 *
		 * This will commit the elements in the collection to the local device's database, but these changes will not be
		 * propagated to the server or other devices.
		 *
		 * @param {Object} [options]
		 * A map of options to control how this MDO.Collection is saved
		 *
		 * @param {boolean} [options.localOnly=false]
		 * `true` if no transactions should be generated for this update; The changes made to this collection
		 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs
		 *
		 * @param {boolean} [options.silent=false]
		 * Set to `true` to suppress the {@link MDO.Connection#event-data_modified data_modified} and
		 * {@link MDO.Connection#event-data_added data_added} events that fire when each element is saved.
		 *
		 * @returns {Promise.<MDO.Collection>}
		 * Resolves with this Collection when all records in the collection have been inserted or updated in the
		 * database.
		 *
		 * @async
		 */
		saveAllElements: function (options) {
			var promises = this.map(function(elt) {
				return elt.save(null, options);
			});

			return AH.whenSettle(promises)
				.then(function () { return AH.whenAll(promises); })
				.yield(this);
		},

		/**
		 * @method _fetchRefs
		 * @private
		 * Fetch element references specified using {@link MDO.Collection#queryInclude queryInclude}
		 * and add them to this collection.
		 *
		 * @param {Object} refOptions
		 *
		 * The `options` passed from the parent collection, possibly containing `fromServer` and `timeout` settings.
		 *
		 * @return {Promise}
		 * Resolves when all referenced (merged) elements have been fetched
		 */
		_fetchRefs: function (refOptions) {
			if (!this.includedRefs) {
				return this;
			}

			var self = this, includedRefs = _.keys(this.includedRefs);

			// Sort be merge level - we want merged references fetched last
			includedRefs.sort(function(a, b) {
				var depthA = a.split(".").length;
				var depthB = b.split(".").length;
				var depth = depthA - depthB;
				if (depth) {
					return depth;
				}
				if (a < b) {
					return -1;
				}

				return a > b ? 1 : 0;
			});

			// Remove first reference ("")
			includedRefs.shift();

			// mergedRefName -> { refElement, refCol }
			var parentRefs = {};

			// Iterate over includedRefs, e.g. ["ahAssetRef", "ahAssetRef.ahLocationRef"]
			return _.reduce(includedRefs, function(prev, mergedRefName) {

				var parentCol, fKey;
				var refName, refElement;

				return prev
					.then(fetchReferences)
					.then(assignReferences);

				// Resolve with a fetched collection of elements accessed via mergedRefName
				function fetchReferences() {
					var mergeIndex = mergedRefName.lastIndexOf(".");

					if (mergeIndex < 0) {
						// Top-level reference, e.g. "ahAssetRef"
						parentCol = self;
						refName = mergedRefName;
					} else {
						// Merged reference, e.g. "ahAssetRef.ahLocationRef"
						var parent = parentRefs[mergedRefName.substr(0, mergeIndex)];
						parentCol = parent.refCol;
						refName = mergedRefName.substr(mergeIndex + 1);
					}

					// Get ModelElement for the reference we're processing
					refElement = parentCol.mdoClass.allElements.getByName(refName, true);

					// Create collection of referenced model class
					var refClass = refElement.refClass;
					var refCol = self.mdoConnection.createCollection(refClass.name);

					// Stash away foreign key column
					fKey = refElement.referenceField.name;

					// Collect unique, non-null foreign keys
					var keys = _.filter(_.unique(parentCol.pluck(fKey)), _.identity);
					if (keys.length) {
						// Execute query to fetch referenced elements
						var filter = "$" + refClass.idField.name + " IN ("
							+ keys.join(",")
							+ ")";
						refCol.queryFilter(filter);
						var fields = self.includedRefs[mergedRefName];
						var options = _.isArray(fields) ? { fields: fields } : {};
						return refCol.fetch(_.extend(options, refOptions));
					}

					// Empty collection
					return AH.resolve(refCol);
				}

				// Assign refName properties in parent collection to referenced elements
				// Returns the self collection.
				function assignReferences(refCol) {
					// Build lookup cache { Element.PKey -> Element }
					var cache = {};
					refCol.forEach(function(elt) {
						cache[elt.id] = elt;
					});

					// Assign references
					parentCol.forEach(function(elt) {
						elt[refName] = cache[elt[fKey]] || null;
					});

					// Store info to use by merged references
					parentRefs[mergedRefName] = {
						refElement: refElement,
						refCol: refCol
					};

					return self;
				}

			}, AH.resolve(this), this);
		},

		/**
		 * @method sync
		 * @private
		 * Implements loading and saving element to the data store.
		 * Overrides backbone.js implementation.
		 *
		 * @param {string} method
		 * Supported Methods: 'read'.
		 * Unsupported Methods: 'create', 'update', 'delete'.
		 *
		 * @param {Backbone.Model} model
		 * Not used by MDO.Collection's implementation of Sync
		 *
		 * @param {Object} options
		 *
		 * @param {number} [options.limit=no limit]
		 * Limit the number of records fetched.
		 *
		 * @param {number} [options.offset=0]
		 * Skip the specified number of records when fetching.
		 *
		 * @param {boolean} [options.fromServer=false]
		 * Retrieve data from the server instead of local datastore.
		 *
		 * @param {boolean} [options.totalCount=false]
		 * Set the {@link #totalCount} property when fetching data.
		 *
		 * @param {number} [options.timeout==120000]
		 * If fromServer is true, the duration, in milliseconds, for the request to wait before it is considered to have timed-out.
		 *
		 * @return {Promise}
		 * Resolves when the operation is completed
		 */
		sync: function (method, model, options) {
			var ds = this._ds;
			var self = this;
			var config, filter;

			function onSuccess(resp) {
				self.totalCount = _.isUndefined(resp.totalCount) ? undefined : resp.totalCount;
				options.success(resp);
				return AH.resolve(self);
			}

			function onError(err) {
				if (options.error) {
					options.error(err);
				}
				return AH.reject(err);
			}

			function doQuery() {
				return ds.getRows(config);
			}

			switch (method) {
				case "read":
					filter = self._filter;
					if (!_.isString(filter)) {
						// Fetch based on filter fields
						filter = this.mdoClass.getFieldFilter(this._filter || {});
					}

					config = {
						fromServer: Boolean(options.fromServer),
						timeout: options.timeout,
						className: self.mdoClass.name,
						filter: filter,
						filterParams: self._filterParams,
						totalCount: options.totalCount,
						queryOptions: {
							orderBy: this._order,
							limit: options.limit,
							offset: options.offset,
							fields: options.fields
						}
					};

					return doQuery()
						.then(onSuccess, onError);

				case "create":
				case "update":
				case "delete":
				default:
					return AH.reject(new Error("MDO.Collection sync method not implemented: " + method));
			}
		}
	});

	// Add mixins
	_.extend(MdoCollection.prototype, QueryIncludeMixin);

	/**
	 * @property {Number} totalCount
	 * @readonly
	 *
	 * Total number of records matched by filter in last call to {@link #fetch} when `options.totalCount=true`.
	 * The value is `undefined` when {@link #fetch} is called without specifying `option.totalCount=true`.
	 *
	 * ## Usage:
	 *
	 *      mdoCol.fetch({ limit: 10, totalCount: true })
	 *          .then(function() {
	 *              console.log("Fetched " + mdoCol.length + " out of " + mdoCol.totalCount);
	 *          });
	 */

	/**
	 * @property {DataModel.Class} mdoClass
	 * @readonly
	 *
	 * This collection's model class.
	 */
	Object.defineProperty(MdoCollection.prototype, "mdoClass", {
		get: function () { return this._class; }
	});

	/**
	 * @property {MDO.Connection} mdoConnection
	 * @readonly
	 *
	 * The MDO.Connection for which this collection was created.
	 */
	Object.defineProperty(MdoCollection.prototype, "mdoConnection", {
		get: function () { return this._mdoCon; }
	});

	return MdoCollection;

	/**
	 * @property {number} length
	 * @readonly
	 *
	 * Number of elements in the collection.
	 */

	/**
	 * @method forEach
	 *
	 * Iterates over a list of elements, yielding each in turn to an iterator function.
	 * The iterator is bound to the context object, if one is passed.
	 * Each invocation of iterator is called with three arguments: (element, index, list).
	 *
	 * ## Usage:
	 *
	 *     // Alert with the description of each element in collection
	 *     mdoCol.forEach(function(mdoElt) {
	 *         alert(mdoElt.ahDescription);
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 */

	/**
	 * @method map
	 * Produces an array of values by mapping each element in collection through a transformation function (iterator).
	 *
	 * The iterator is bound to the context object, if one is passed.
	 * Each invocation of iterator is called with three arguments: (element, index, list).
	 *
	 * ## Usage:
	 *
	 *     // Create an arreay of concatenated names
	 *     var names = mdoCol.map(function(mdoElt) {
	 *         return mdoElt.ahFirstName + " " + mdoElt.ahLastName;
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {Array}
	 * Array of values returned by the `iterator`.
	 */

	/**
	 * @method reduce
	 *
	 * Boils down elements into a single value.
	 * Memo is the initial state of the reduction, and each successive step of it should be returned by iterator.
	 *
	 * ## Usage:
	 *
	 * The following example adds up the costs of all the elements in the `mdoLineItemsCol` collection:
	 *
	 *     var sum = mdoLineItemsCol.reduce(function(total, mdoElt){
	 *         return total + (mdoElt.ahCount * mdoElt.ahPrice);
	 *     }, 0);
	 *
	 * @param {Function} iterator
	 * The iterator is passed four arguments: the `memo`, then the element and index of the iteration, and finally a reference to the entire collection.
	 *
	 * @param memo
	 * Initial state of the reduction.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns
	 * The value returned from the last `iterator` call or `memo`, if the collection is empty.
	 */
	
	/**
	 * @method find
	 * Looks through each value in the list, returning the first one that passes a truth test (iterator).
	 *
	 * ## Usage:
	 *
	 * The following example returns the first active task:
	 *
	 *     var mdoTaskElt = mdoTasksCol.find(function(mdoTask) {
	 *         return mdoTask.ahStatus === 'ACTIVE'
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {MDO.Element}
	 * First element that passes the truth test or `null`.
	*/
	
	/**
	 * @method filter
	 * Looks through each element in the collection, returning an array of all the elements that pass a truth test (iterator).
	 *
	 * Note: Use the {@link MDO.Collection#queryFilter} method to specify which elements should be fetched by a collection.
	 *
	 * ## Usage:
	 *
	 * The following example returns an array of active tasks:
	 *
	 *     var mdoTaskElt = mdoTasksCol.queryFilter(function(mdoTask) {
	 *         return mdoTask.ahStatus === 'ACTIVE'
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {MDO.Element[]}
	 * Array of element that passes the truth test.
	 */
	
	/**
	 * @method where
	 * Looks through each element in the collection, returning an array of all the elements that contain all of the key-value pairs listed in `properties`.
	 *
	 * ## Usage:
	 *
	 * The following example returns an array of 'REPAIR' task that are 'ACTIVE':
	 *
	 *     var mdoTaskCol = mdoTasksCol.where({
	 *         ahType: 'REPAIR',
	 *         ahStatus: 'ACTIVE'
	 *     });
	 *
	 * @returns {MDO.Element[]}
	 * Array of elements that pass the truth test.
	 */
	
	/**
	 * @method reject
	 * Returns an array of elements without the elements that the truth test (iterator) passes.
	 *
	 * ## Usage:
	 *
	 * The following example returns an array of tasks that are _not_ 'ACTIVE':
	 *
	 *     var mdoTasks = mdoTasksCol.reject(function(mdoTask) {
	 *         return mdoTask.ahStatus === 'ACTIVE'
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {MDO.Element[]}
	 * Array of element that did not pass the truth test.
	 */
	
	/**
	 * @method every
	 * Returns true if all the elements in the collection pass the iterator truth test.
	 *
	 * ## Usage:
	 *
	 * The following example returns `true` if all tasks in the collection are 'ACTIVE':
	 *
	 *     var allAreActive = mdoTasksCol.every(function(mdoTask) {
	 *         return mdoTask.ahStatus === 'ACTIVE'
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {boolean}
	 * Indicates whether all elements passed the test.
	 */

	/**
	 * @method some
	 * Returns `true` if any of the elements in the collection pass the iterator truth test.
	 *
	 * ## Usage:
	 *
	 * The following example returns `true` if any tasks in the collection are 'ACTIVE':
	 *
	 *     var someAreActive = mdoTasksCol.some(function(mdoTask) {
	 *         return mdoTask.ahStatus === 'ACTIVE'
	 *     });
	 *
	 * @param {Function} iterator
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {boolean}
	 * Indicates whether at least one elements passes the test.
	 */
	
	/**
	 * @method pluck
	 * Returns an array of values from the specified element field.
	 *
	 * ## Usage:
	 *
	 * The following example returns an array of logins:
	 *
	 *     var logins = mdoUserCol.pluck('ahLogin');
	 *
	 * @param {String} propertyName
	 *
	 * Name of the property to be returned.
	 *
	 * @returns {Array}
	 * Array of property values
	*/
	
	/**
	 * @method max
	 * Returns the largest element value in the collection calculated by the `iterator`.
	 *
	 * ## Usage:
	 *
	 * The following example returns the maximum costs of all the elements in the `mdoLineItemsCol` collection:
	 *
	 *     var maxLineItem = mdoLineItemsCol.max(function(mdoElt){
	 *         return mdoElt.ahCount * mdoElt.ahPrice;
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {Number}
	 * Largest calculated value.
	 */
	
	/**
	 * @method min
	 * Returns the smallest element value in the collection calculated by the `iterator`.
	 *
	 * ## Usage:
	 *
	 * The following example returns the minimum costs of all the elements in the `mdoLineItemsCol` collection:
	 *
	 *     var minLineItem = mdoLineItemsCol.min(function(mdoElt){
	 *         return mdoElt.ahCount * mdoElt.ahPrice;
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {Number}
	 * Smallest calculated value.
	 */
	
	/**
	 * @method sortBy
	 * Returns a sorted copy of list, ranked in ascending order by the results of running each value through iterator.
	 *
	 * Iterator may also be the string name of the property to sort by (eg. `"ahName"`).
	 *
	 * Note: Use the {@link MDO.Collection#querySort} method to specify the order in which elements should be fetched.
	 *
	 * @param iterator
	 *
	 * Callback {Function} invoked with `(MDO.Element element`.
	 *
	 * Iterator may also be the string name of the property to sort by (eg. `ahName`).
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {MDO.Element[]}
	 *
	 * An array of elements containing contents of the collection sorted based on `iterator`.
	 *
	 * ## Usage:
	 *
	 * The following example returns the elements in the `mdoPeopleCol` sorted by the `ahLastName` property:
	 *
	 *     var peopleArray = mdoPeopleCol.sortBy('ahLastName');
	 *
	 * The following example returns the elements in the `mdoPeopleCol` sorted by the `ahLastName` and `ahFirstName` properties:
	 *
	 *     var peopleArray = mdoPeopleCol.sortBy(function(mdoElt){
	 *         return mdoElt.ahLastName + " " + mdoElt.ahFirstName;
	 *     });
	 *
	 */
	
	/**
	 * @method groupBy
	 * Splits a collection into sets, grouped by the result of running each value through iterator.
	 * If iterator is a string instead of a function, groups by the property named by iterator on each of the values.
	 *
	 * ## Usage:
	 *
	 * Group a list of tasks by their category property:
	 *
	 *     var groupedTasks = mdoTaskCol.groupBy("ahCategory");
	 *
	 * Group a list of tasks based on their ahLength property into short, medium and long:
	 *
	 *     var groupedTasks = mdoTaskCol.groupBy(function(mdoTaskElt) {
	 *         var length = mdoTaskElt.ahLength;
	 *         if(lengths < 30) {
	 *             return "short";
	 *         }
	 *         if(length < 60) {
	 *             return "medium";
	 *         }
	 *         return "long";
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {Object}
	 * Object whose keys are the group value returned by the iterator and whose values are arrays of matched elements.
	 */
	
	/**
	 * @method countBy
	 * Splits a collection into sets, grouped by the result of running each value through iterator.
	 * If iterator is a string instead of a function, groups by the property named by iterator on each of the values.
	 *
	 * ## Usage:
	 *
	 * Count a list of tasks by their category property:
	 *
	 *     var taskCounts = mdoTaskCol.countBy("ahCategory");
	 *
	 * Group a list of tasks based on their ahLength property into short, medium and long:
	 *
	 *     var taskCounts = mdoTaskCol.countBy(function(mdoTaskElt) {
	 *         var length = mdoTaskElt.ahLength;
	 *         if(lengths < 30) {
	 *             return "short";
	 *         }
	 *         if(length < 60) {
	 *         return "medium";
	 *         }
	 *         return "long";
	 *     });
	 *
	 * @param {Function} iterator
	 *
	 * Callback invoked with `(MDO.Element element, {Number} index, MDO.Collection collection)`.
	 *
	 * @param [context]
	 * Context (`this`) in which the iterator is invoked.
	 *
	 * @returns {Object}
	 * Object whose keys are the group value returned by the iterator and whose values are the number of of matched elements.
	 */
	
	/**
	 * @method toArray
	 *
	 * Converts the collection into a real {Array}.
	 *
	 * ## Usage:
	 *
	 *     var taskArray = mdoTaskCol.toArray();
	 *
	 * @returns {MDO.Element[]}
	 *
	 * Elements in the collection.
	 */
	
	/**
	 * @method size
	 *
	 * Returns the length of the collection.
	 *
	 * ## Usage:
	 *
	 *     var count = mdoTaskCol.size();
	 *
	 * @returns {Number}
	 *
	 * Number of elements in the collection.
	 */
	
	/**
	 * @method first
	 * Returns the first element of the collection.
	 * Passing `n` will return the first `n` elements as an array.
	 *
	 * ## Usage:
	 *
	 * Return the first task from a collection:
	 *
	 *     var mdoTaskElt = mdoTaskCol.first();
	 *
	 * Return the first 3 tasks from a collection:
	 *
	 *     var mdoTaskArray = mdoTaskCol.first(3);
	 *
	 * @param {Number} [n=undefined]
	 *
	 * Number of elements to return.
	 *
	 * @returns {MDO.Element[]}
	 *
	 * First `n` elements in the collection.
	 */
	
	/**
	 * @method initial
	 * Returns everything but the last entry of the collection.
	 * Passing `n` will exclude the last `n` elements from the result.
	 *
	 * ## Usage:
	 *
	 *     Return all but the last task in a collection:
	 *
	 * var mdoTaskArray = mdoTaskCol.initial();
	 *
	 * Return all but the last 3 tasks from a collection:
	 *
	 *     var mdoTaskArray = mdoTaskCol.initial(3);
	 *
	 * @param {Number} [n=1]
	 *
	 * Number of elements to exclude.
	 *
	 * @returns {MDO.Element[]}
	 *
	 * First `n` elements in the collection.
	 */
	
	/**
	 * @method last
	 * Returns the last element of the collection.
	 * Passing `n` will return the last `n` elements as an array.
	 *
	 * ## Usage:
	 *
	 * Return the last task from a collection:
	 *
	 *     var mdoTaskElt = mdoTaskCol.last();
	 *
	 * Return the last 3 tasks from a collection:
	 *
	 *     var mdoTaskArray = mdoTaskCol.last(3);
	 *
	 * @param {Number} [n=undefined]
	 *
	 * Number of elements to return.
	 *
	 * @returns {MDO.Element[]}
	 *
	 * Last `n` elements in the collection.
	 */
	
	/**
	 * @method rest
	 * Returns all but the first elements in the collection.
	 * Pass an index to return the values of the collection from that index onward.
	 *
	 * ## Usage:
	 *
	 * Return all but the first task from a collection:
	 *
	 *     var mdoTaskArray = mdoTaskCol.rest();
	 *
	 * Return all but the first 3 tasks from a collection:
	 *
	 *     var mdoTaskArray = mdoTaskCol.rest(3);
	 *
	 * @param {Number} [n=1]
	 *
	 * Number of elements to skip.
	 *
	 * @returns {MDO.Element[]}
	 *
	 * All but the first `n` elements in the collection.
	 */
	
	/**
	 * @method isEmpty
	 *
	 * Returns `true` if the collection is empty.
	 *
	 * ## Usage:
	 *
	 *     var hasElements = !mdoTasksCol.isEmpty();
	 *
	 * @returns {boolean}
	 *
	 * True if collection contains zero elements.
	 */

	/**
	 * @event remove
	 * Fires when an element is removed from this collection
	 *
	 * @param {MDO.Element} element
	 * The MDO.Element that is being removed from this collection
	 *
	 * @param {MDO.Collection} collection
	 * The MDO.Collection from which the element is being removed
	 *
	 * @param {Object} options
	 * The options used when removing this element from the collection
	 */

	/**
	 * @event add
	 * Fires when an element is added to the collection
	 *
	 * @param {MDO.Element} element
	 * The MDO.Element that is being added to this collection
	 *
	 * @param {MDO.Collection} collection
	 * The MDO.Collection to which the element is being added
	 *
	 * @param {Object} options
	 * The options that were passed to the method adding elements
	 */

	/**
	 * @event sync
	 * Fires whenever this collection's elements are synchronized with the datastore during a #fetch operation
	 *
	 * @param {MDO.Collection} collection
	 * The MDO.Collection that was synchronized
	 *
	 * @param {Array.<MDO.Element>} elements
	 * The list of elements that was loaded into the collection
	 *
	 * @param {Object} options
	 * The options that were passed to #fetch
	 */

	/*
	NOTE: We don't publickly document the following Backbone methods:

	contains(list, value)
	invoke(list, methodName, [*arguments])
	shuffle(list)

	*/
});
define('Http/FileServer',[
	"underscore",
	"./ajax",
	"./Config",
	"AH",
	"Constants"
], function (
	_,
	ajax,
	HttpConfig,
	AH,
	Constants
) {
	"use strict";

	/**
	 * @enum {string} Http.FileServer.Action
	 * @private
	 */
	/**
	 * @property {string} [getInfo='info']
	 * Get file information from the server
	 */
	/**
	 * @property {string} [downloadFile='download']
	 * Download the specified file
	 */
	/**
	 * @property {string} [uploadFile='upload']
	 * Upload the specified file
	 */

	/**
	 * @class Http.FileServer
	 * @private
	 */

	/**
	 * @constructor
	 *
	 * @param {Object} config
	 * configuration for the FileServer
	 *
	 * @param {string} config.domain
	 * The GUID or name for the domain.
	 *
	 * @param {string} config.deviceId
	 * The GUID for the device or the name for the user. If deviceSharing is true,
	 * this should be the GUID for the device. Otherwise, this should be
	 * the name of the user.
	 *
	 * @param {string} config.user
	 * The user's name.
	 *
	 * @param {string} config.password
	 * The user's password.
	 *
	 * @param {string} [config.baseUrl]
	 * HTTP endpoint for file transfers; Default is `/MTierServices/FileTransfer.aspx`
	 */
	return function (config) {
		// Initialize baseUri
		var baseUri = config.baseUrl || "/MTierServices/FileTransfer.aspx";
		baseUri += "?domain=" + encodeURIComponent(config.domain);
		baseUri += "&deviceID=" + encodeURIComponent(config.deviceId);
		baseUri += "&passThroughAuth=" + Boolean(config.sharedDevice);

		var fileServerActions = {
			getInfo: "info",
			downloadFile: "download",
			uploadFile: "upload"
		};

		/**
		 * @method ajaxRequest
		 * @private
		 * Make an ajax request to the given location with the provided options and, optionally, timeout.
		 *
		 * @param {string} url
		 * URL of the server to make the request against.
		 *
		 * @param {Object} options
		 * Ajax options.
		 *
		 * @param {number} [options.timeout=5000]
		 * Duration in milliseconds to wait before FileServer considers the request to have timedout.
		 *
		 * @return {Promise.<Object>}
		 */
		var ajaxRequest = _ajaxRequest;
		function _ajaxRequest(url, options) {
			var settings = _.extend({
				url: url,
				type: "GET",
				timeout: HttpConfig.attachmentTimeout,
				dataType: "application/binary",
				headers: {
					// iOS 6 caches POST requests unless they
					// explicitly specify that they shouldn't be cached
					"Cache-Control": "no-cache",
					"X-AHUser": config.user,
					"X-AHPassword": config.password
				}
			}, options);
			return ajax.ajax(settings);
		}

		/**
		 * @method dateToVariantTime
		 * @private
		 * Converts a JavaScript date to an VARIANT DATE value
		 */
		var baseVariantTime = new Date(1900, 0, -1, -6).getTime();
		function dateToVariantTime(date) {
			var deltaMs = date.getTime() - baseVariantTime;
			// 86400000 = number of milliseconds in a day.
			return deltaMs / (86400000);
		}

		/**
		 * @method getServiceUri
		 * @private
		 * Returns the FileServer URL for the specified args:
		 * action, datastore, fileClass, fileName, id, lastModified
		 *
		 * @param {Http.FileServer.Action} action
		 * The FileServer.Action to perform
		 *
		 * @param {Object} args
		 * Parameters to the request
		 *
		 * @param {string} args.datastore
		 * The name of the datastore or its GUID. If the file server was constructed
		 * with a GUID for the domain, then datastore must be a GUID. Likewise, if
		 * the file server was constructed with the domain name, datastore must be
		 * the datastore name.
		 *
		 * @param {string} args.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @param {string} args.fileName
		 * The name of the file to download.
		 *
		 * @param {string} args.id
		 * The primary key of the file
		 *
		 * @return {string}
		 * the uri for the given action and args
		 */
		function getServiceUri(action, args) {
			var params = [
				baseUri,
				"action=" + encodeURIComponent(action),
				"datastore=" + encodeURIComponent(args.datastore),
				"fileclass=" + encodeURIComponent(args.fileClass),
				"filename=" + encodeURIComponent(args.fileName),
				"pkey=" + encodeURIComponent(args.id)
			];

			if (args.lastModified) {
				params.push("lastmodified=" + encodeURIComponent(dateToVariantTime(args.lastModified)));
			}

			return params.join("&");
		}

		/**
		 * @method downloadFile
		 * Downloads a file from the server
		 *
		 * @param {Object} args
		 * Parameters to the request
		 *
		 * @param {string} args.datastore
		 * The name of the datastore or its GUID. If the file server was constructed
		 * with a GUID for the domain, then datastore must be a GUID. Likewise, if
		 * the file server was constructed with the domain name, datastore must be
		 * the datastore name.
		 *
		 * @param {string} args.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @param {string} args.fileName
		 * The name of the file to download.
		 *
		 * @param {string} args.id
		 * The primary key of the file
		 *
		 * @param {number} [args.timeout=5000]
		 * Duration in milliseconds to wait before FileServer considers the request to have timedout.
		 *
		 * @return {Promise.<Object>}
		 * Resolves with the details of the file.
		 *
		 * @return {number} return.size
		 * The size, in bytes, of the file.
		 *
		 * @return {number} return.version
		 * The version of the file on the server.
		 *
		 * @return {ArrayBuffer} return.contents
		 * The contents of the file.
		 *
		 * @return {string} return.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @return {string} return.fileName
		 * The name of the downloaded file.
		 */
		function downloadFile(args) {
			var uri = getServiceUri(fileServerActions.downloadFile, args);
			return ajaxRequest(uri, {
				// We expect binary data
				responseType: "arraybuffer",
				timeout: args.timeout || HttpConfig.attachmentTimeout
			}).then(function (reply) {
				var fileInfo = _.extend({
					size: Number(reply.xhr.getResponseHeader("X-AHFileSize")),
					version: Number(reply.xhr.getResponseHeader("X-AHFileServerVersion")),
					contents: reply.data
				}, _.pick(args, "fileName", "fileClass"));
				if (fileInfo.version < 0) {
					// Reject with serverFileNotFound error
					var err = new Error("Server file not found: " + args.fileClass + ":" + args.fileName);
					err.mdoCode = Constants.errorCodes.serverFileNotFound;
					return AH.reject(err);
				}
				return fileInfo;
			});
		}

		/**
		 * @method isServerFileNewer
		 * @private
		 * Checks if the version of the file on the server is newer than the file on the client.
		 *
		 * @param {Object} args
		 * Parameters to the request
		 *
		 * @param {string} args.datastore
		 * The name of the datastore or its GUID. If the file server was constructed
		 * with a GUID for the domain, then datastore must be a GUID. Likewise, if
		 * the file server was constructed with the domain name, datastore must be
		 * the datastore name.
		 *
		 * @param {string} args.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @param {string} args.fileName
		 * The name of the file to download.
		 *
		 * @param {string} args.id
		 * The primary key of the file
		 *
		 * @return {Promise.<boolean>}
		 * Resolves with true if the version of the file on the server is newer than the file
		 * on the client.
		 */
		var isServerFileNewer = _isServerFileNewer;
		function _isServerFileNewer(args) {
			var uri = getServiceUri(fileServerActions.getInfo, args);
			return ajaxRequest(uri)
				.then(function (reply) {
					return AH.resolve(reply.xhr.getResponseHeader("X-AHServerFileNewer") === "1");
				});
		}

		/**
		 * @method uploadFile
		 * Uploads a file to the server
		 *
		 * @param {Object} args
		 * Parameters to the request
		 *
		 * @param {string} args.datastore
		 * The name of the datastore or its GUID. If the file server was constructed
		 * with a GUID for the domain, then datastore must be a GUID. Likewise, if
		 * the file server was constructed with the domain name, datastore must be
		 * the datastore name.
		 *
		 * @param {string} args.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @param {string} args.fileName
		 * The name of the file to upload.
		 *
		 * @param {string} args.id
		 * The primary key of the file
		 *
		 * @param {ArrayBuffer} contents
		 * The contents of the file.
		 *
		 * @param {number} [args.timeout=5000]
		 * Duration in milliseconds to wait before FileServer considers the request to have timedout.
		 *
		 * @return {Promise.<Object>}
		 * Resolves with the details of the file.
		 *
		 * @return {number} return.size
		 * The size, in bytes, of the file.
		 *
		 * @return {number} return.version
		 * The version of the file on the server.
		 *
		 * @return {ArrayBuffer} return.contents
		 * The contents of the file.
		 *
		 * @return {string} return.fileClass
		 * The name of the file's DataModel.Class.
		 *
		 * @return {string} return.fileName
		 * The name of the uploaded file.
		 */
		function uploadFile(args, contents) {
			return isServerFileNewer(args)
				.then(function (serverFileNewer) {
					if (serverFileNewer) {
						// Reject with serverFileNewer error
						var err = new Error("Server file is newer: " + args.fileClass + ":" + args.fileName);
						err.mdoCode = Constants.errorCodes.serverFileNewer;
						return AH.reject(err);
					}

					var uri = getServiceUri(fileServerActions.uploadFile, args);
					// Android bug won't upload blobs
					var dataPromise = null;
					if (contents instanceof Blob) {
						dataPromise = convertBlobToArrayBuffer(contents);
					} else {
						dataPromise = AH.resolve(contents);
					}

					return dataPromise.then(function(data) {
						return ajaxRequest(uri, {
							type: "POST",
							// We're sending binary data
							processData: false,
							data: data,
							timeout: args.timeout || HttpConfig.attachmentTimeout
						}).then(function (reply) {
							return _.extend({
								version: Number(reply.xhr.getResponseHeader("X-AHFileServerVersion"))
							}, _.pick(args, "fileName", "fileClass"));
						});
					});
				});
		}

		/**
		 * @method convertBlobToArrayBuffer
		 * @private
		 * Converts a `Blob` into an `ArrayBuffer`. This is done as an asynchronous operation and requires FileReader support.
		 *
		 * @param {Blob} blob The Blob to convert
		 * @returns {Promise.<ArrayBuffer>}
		 */
		function convertBlobToArrayBuffer(blob) {
			var deferred = AH.defer();
			var fileReader = new FileReader();
			fileReader.onload = function(evt) {
				deferred.resolve(evt.target.result);
			};
			fileReader.readAsArrayBuffer(blob);
			return deferred.promise;
		}

		var exports = {
			downloadFile: downloadFile,
			uploadFile: uploadFile,

			_dateToVariantTime: dateToVariantTime,
			_getServiceUri: getServiceUri
		};

		Object.defineProperties(exports, {
			_ajaxRequest: {
				get: function () {
					return ajaxRequest;
				},
				set: function (val) {
					ajaxRequest = val;
				}
			},

			_isServerFileNewer: {
				get: function () {
					return isServerFileNewer;
				},
				set: function (val) {
					isServerFileNewer = val;
				}
			}
		});

		return exports;

	};
});
define('MDO/VaultSynchronizer',[
	"underscore",
	"AH",
	"Constants",
	"Messages/Message"
], function (
		_,
		AH,
		Constants,
		Message
	) {
	"use strict";

	// Files where a newer version is available on the server
	var vaultDownloadFilter = "(ahLocalVersion IS NULL OR ahLocalVersion < ahServerVersion)"
		+ " AND ahCurrentUploadTS IS NULL AND ahServerVersion >= 1";
	// Files that the client is interested in
	var onDemandWantsFileFilter = "(ahOnDemand IS NULL OR ahOnDemand=0 OR ahSubscribed <> 0)";
	// Files that have been modified on the client
	var vaultUploadFilter = "ahCurrentUploadTS IS NOT NULL";

	return function (mdoCon) {

		// getDownloadCollection(fileClasses)
		//
		// Returns a promise that resolves with an array of FileElement MdoCollections
		// containing elements whose local files are out of data.
		//
		// Returns a promise that resolves with an array of fetched collections
		//
		var getDownloadCollections = _getDownloadCollections;
		function _getDownloadCollections(fileClasses) {

			var filter = vaultDownloadFilter + " AND " + onDemandWantsFileFilter;
			var promises = _.map(fileClasses, function (cl) {
				var mdoCol = mdoCon.createCollection(cl.name);
				mdoCol.queryFilter(filter);
				return mdoCol.fetch();
			});

			return AH.whenAll(promises);
		}

		// getFileClasses()
		//
		// Returns an array of ModelClasses of type File
		//
		var getFileClasses = _getFileClasses;
		function _getFileClasses() {
			return _.filter(mdoCon.model.classes, function (cl) {
				return cl.isFileClass;
			});
		}

		// deleteMissingServerRecord(mdoElt)
		//
		// Locally deletes mdoElt, ignoring errors
		//
		var deleteMissingServerRecord = _deleteMissingServerRecord;
		function _deleteMissingServerRecord(mdoElt) {
			return mdoElt.destroy({ localOnly: true })
				.then(null, function () {
					// Ignore error
				});
		}

		// downloadFile(mdoElt)
		//
		// Downloads vault file and if server responds with serverFileNotFound error
		// locally deletes the file record.
		//
		var downloadFile = _downloadFile;
		function _downloadFile(mdoElt, timeout) {
			return mdoElt.downloadFile(timeout)
				.then(function () {
					return mdoElt.save(null, { localOnly: _.keys(mdoElt.attributes) });
				}, function (err) {
					if (err.mdoCode === Constants.errorCodes.serverFileNotFound) {
						return deleteMissingServerRecord(mdoElt);
					}

					return AH.reject(err);
				});
		}

		// downloadFilesInCollections(mdoColArray)
		//
		// Downloads vault files for all elements in the array of collections
		//
		// Returns a promise that resolves when downloads are complete.
		//
		var downloadFilesInCollections = _downloadFilesInCollections;
		function _downloadFilesInCollections(mdoColArray, timeout) {

			var totalCount = _.reduce(mdoColArray, function (sum, mdoCol) {
				return sum + mdoCol.length;
			}, 0);

			var count = 0;

			var promise = _.reduce(mdoColArray, function (colPromise, mdoCol) {
				return mdoCol.reduce(function (eltPromise, mdoElt) {
					return eltPromise.then(function () {
						count++;
						return AH.notify(Message.getMessage(Constants.messageCodes.downloadingVaultFile, count, totalCount, mdoElt.ahFileName), downloadFile(mdoElt, timeout));
					});
				}, colPromise);
			}, AH.resolve());

			if (totalCount) {
				promise = AH.notify(Message.getMessage(Constants.messageCodes.downloadingVaultFiles, totalCount), promise);
			}

			return promise;
		}

		// downloadVaultFiles()
		//
		// Download vault files that are out of date and the client is interested in
		//
		// Returns a promise that resolves when file are downloaded
		//
		function downloadVaultFiles(timeout) {
			var promise = getDownloadCollections(getFileClasses())
				.then(function (mdoColArray) {
					return downloadFilesInCollections(mdoColArray, timeout);
				});
			return AH.notify(Message.getMessage(Constants.messageCodes.checkingForAttachmentDownloads), promise);
		}

		// getUploadCollections(fileClasses)
		//
		// Returns a promise that resolves with an array of FileElement MdoCollections
		// containing elements whose local files should be uploaded.
		//
		// Returns a promise that resolves with an array of fetched collections
		//
		var getUploadCollections = _getUploadCollections;
		function _getUploadCollections(fileClasses) {

			var filter = vaultUploadFilter;
			var promises = _.map(fileClasses, function (cl) {
				var mdoCol = mdoCon.createCollection(cl.name);
				mdoCol.queryFilter(filter);
				return mdoCol.fetch();
			});

			return AH.whenAll(promises);
		}

		// uploadFilesInCollections(mdoColArray)
		//
		// Uploads vault files for all elements in the array of collections
		//
		// Returns a promise that resolves when uploads are complete.
		//
		var uploadFilesInCollections = _uploadFilesInCollections;
		function _uploadFilesInCollections(mdoColArray, timeout) {

			var totalCount = _.reduce(mdoColArray, function (sum, mdoCol) {
				return sum + mdoCol.length;
			}, 0);

			var count = 0;

			var promise = _.reduce(mdoColArray, function (colPromise, mdoCol) {
				return mdoCol.reduce(function (eltPromise, mdoElt) {
					return eltPromise.then(function () {
						count++;
						return AH.notify(Message.getMessage(Constants.messageCodes.uploadingVaultFile, count, totalCount, mdoElt.ahFileName), mdoElt.uploadFile(timeout));
					});
				}, colPromise);
			}, AH.resolve());

			if (totalCount) {
				promise = AH.notify(Message.getMessage(Constants.messageCodes.uploadingVaultFiles, totalCount), promise);
			}

			return promise;
		}

		function uploadVaultFiles(timeout) {
			var promise = getUploadCollections(getFileClasses())
				.then(function (mdoColArray) {
					return uploadFilesInCollections(mdoColArray, timeout);
				});
			return AH.notify(Message.getMessage(Constants.messageCodes.checkingForAttachmentUploads), promise);
		}

		// Public methods
		var exports = {
			downloadVaultFiles: downloadVaultFiles,
			uploadVaultFiles: uploadVaultFiles
		};

		// Private methods for UTs
		Object.defineProperties(exports, {

			_getFileClasses: {
				get: function () {
					return getFileClasses;
				},
				set: function (value) {
					getFileClasses = value;
				}
			},

			_getDownloadCollections: {
				get: function () {
					return getDownloadCollections;
				},
				set: function (value) {
					getDownloadCollections = value;
				}
			},

			_downloadFilesInCollections: {
				get: function () {
					return downloadFilesInCollections;
				},
				set: function (value) {
					downloadFilesInCollections = value;
				}
			},

			_downloadFile: {
				get: function () {
					return downloadFile;
				},
				set: function (value) {
					downloadFile = value;
				}
			},


			_deleteMissingServerRecord: {
				get: function () {
					return deleteMissingServerRecord;
				},
				set: function (value) {
					deleteMissingServerRecord = value;
				}
			},

			_getUploadCollections: {
				get: function () {
					return getUploadCollections;
				},
				set: function (value) {
					getUploadCollections = value;
				}
			},

			_uploadFilesInCollections: {
				get: function () {
					return uploadFilesInCollections;
				},
				set: function (value) {
					uploadFilesInCollections = value;
				}
			}
		});

		return exports;

	};
});
/**
 * @class MDO.Synchronizer
 * @private
 *
 * Synchronization with M-Tier server.
 */
define('MDO/Synchronizer',[
	"underscore",
	"AH",
	"Constants",
	"Http/Server",
	"LocalStorage/Storage",
	"./VaultSynchronizer",
	"Files/fs",
	"Files/fileSystem",
	"./Error",
	"./AsyncEvents",
	"Messages/Message"
], function (
	_,
	AH,
	Constants,
	Server,
	Storage,
	VaultSynchronizer,
	fs,
	FileSystem,
	MdoError,
	AsyncEvents,
	Message
	) {

	"use strict";

	var internal, exports;

	/**
	 * @property {boolean} syncing
	 * @private
	 * @static
	 *
	 * If true, there is currently a Synchronizer performing a sync.
	 * Any attempt to sync while this value is true should reject immediately.
	 */
	var syncing = false;

	/**
	 * @constructor
	 *
	 * @param {MDO.Domain} domain
	 * Domain to synchronize with
	 *
	 * @param {MDO.Connection} mdoCon
	 *
	 *
	 */
	return function (domain, mdoCon) {

		var vaultSync = FileSystem.isSupported && mdoCon && new VaultSynchronizer(mdoCon);

		/**
		 * @method sync
		 *
		 * Uses the specified password along with the UserId and DomainId from the current domain to upload outgoing
		 * MTC files and then download and process incoming files from the DSS server.
		 *
		 * Returns a deferred promise that is resolved when all incoming files have been downloaded and processed.
		 * The returned promise will report progress as actions are completed via Deferred.notify().  Any callers
		 * can display these messages by using a Deferred.progress() callback.
		 *
		 * @param {Object} options
		 *
		 *
		 * @param {string} [user]
		 *
		 *
		 * @param {string} [password]
		 *
		 *
		 * @param {boolean} [deviceSharing=false]
		 *
		 *
		 * @param {boolean} [options.timeout=120000]
		 * Duration in milliseconds to wait between operations before the Synchronizer considers the sync to have timedout.
		 *
		 * @param {boolean} [uploadXacts=true]
		 * If true, sync will upload transactions.
		 *
		 * @param {boolean} [downloadXacts=true]
		 * If true, sync will download transactions.
		 *
		 * @param {boolean} [downloadXactsSizeLimit=5000]
		 * Maximum number of transactions.
		 *
		 * @param {boolean} [uploadFiles=true]
		 * If true, sync will upload modified/new files.
		 *
		 * @param {boolean} [processXacts=true]
		 * If true, sync will process transactions.
		 *
		 * @param {boolean} [downloadFiles=true]
		 * If true, sync will download modified/new files.
		 *
		 * @return {Promise}
		 * Resolves when the sync is complete
		 */
		function sync(options) {
			var defaults = {
				password: "",
				uploadXacts: true,
				downloadXacts: true,
				processXacts: true,
				uploadFiles: true,
				downloadFiles: true,
				downloadXactsSizeLimit: 5000
			};
			options = _.extend(defaults, options);

			if (syncing) {
				return AH.reject(new MdoError("Sync currently in progress", Constants.errorCodes.syncInProgress));
			}

			function syncEvent(name) {
				return function(value) {
					return exports.asyncTrigger("sync:" + name, options)
						.then(function() { return value; });
				};
			}

			syncing = true;

			var syncPromise = AH.deferredTryCatch(function () {
				internal.checkNetworkConnection();


				var credentials = {
					domainId: domain.domInfo.id(),
					userId: domain.domInfo.userId(),
					user: options.user || domain.domInfo.user(),
					password: options.password,
					deviceSharing: options.deviceSharing
				};

				if (!domain.domInfo.serverUrl()) {
					throw new Error("Server information not present in registry");
				}

				var hasNewFiles = false;
				var msStart = (new Date()).valueOf();
				var promise = AH.resolve(), server,
					connectToServer = options.uploadXacts || options.downloadXacts;

				logSyncStarted();

				if (connectToServer) {
					server = new Server(domain.domInfo.serverUrl(), function () {
						return credentials;
					});
					logAuthenticating();
					promise = server.session(function (srvr) {
						var serverPromise = AH.resolve();
						if (options.uploadXacts) {
							serverPromise = serverPromise
								.then(syncEvent("preparingUploadXacts"))
								.then(internal.prepareOutgoingFiles)
								.then(uploadFiles);
						}

						if (options.downloadXacts) {
							serverPromise = serverPromise.then(logRequestFiles)
								.then(_.partial(srvr.getFileList, options.timeout))
								.then(downloadFiles);
						}
						serverPromise.always(logDisconnect);
						return serverPromise;
					});
				}

				if (options.uploadFiles) {
					promise = promise.then(_.partial(internal.uploadVaultFiles, options.timeout));
				}

				if (options.processXacts) {
					promise = promise.then(extractIncoming)
						.then(internal.processIncomingFiles);
				}

				if (options.downloadFiles) {
					promise = promise.then(_.partial(internal.downloadVaultFiles, options.timeout));
				}

				promise.then(logSyncCompleted);


				return promise.then(null, handleSyncFailed);

				// ## uploadFiles()
				//
				// Iterates over each outgoing mtc file and uploads it to the server.
				// Deletes the file from the outgoing directory once a FileAck is received
				//
				function uploadFiles() {

					// Locate any mtc files that are already saved to the file system
					function listExistingMtcFiles() {
						return fs.listFiles(domain.domInfo.outgoingDir(), "*.mtc");
					}

					// Load each file and upload it to the server
					function readFiles(files) {
						var readPromise = AH.resolve();
						if (files && files.length) {
							readPromise = readPromise
								.then(syncEvent("uploadingXacts"));
							readPromise = files.reduce(function (previous, fileInfo, idx) {
								return previous.then(function () {
									var filePromise = fs.readJsonFileContent(fileInfo.dir, fileInfo.name)
										.then(function (mtc) {
											return server.putFile(mtc, options.timeout);
										})
										.then(function () {
											return fs.deleteFile(domain.domInfo.outgoingDir(), fileInfo.name, false);
										});
									logFileToUpload(fileInfo);
									return AH.notify(Message.getMessage(Constants.messageCodes.uploadingFile, idx + 1, files.length), filePromise);
								});
							}, readPromise);

							readPromise = readPromise
								.then(syncEvent("uploadedXacts"));
						}
						return readPromise;
					}

					return listExistingMtcFiles()
						.then(readFiles);
				}

				// ## downloadFiles()
				//
				// Requests all files, in a given file manifest, from the server.
				// It also asks the server to acknowledge successful file downloads.
				//
				// Returns a promise that is resolved when all files have been downloaded
				// and written them to the domain's **Incoming** folder
				//
				function downloadFiles(manifest) {
					hasNewFiles = (manifest.files && manifest.files.length > 0);

					logFilesToDownload((manifest.files || []).length);

					var downloadPromise = AH.resolve();

					if (hasNewFiles) {
						downloadPromise = downloadPromise.then(syncEvent("downloadingXacts"));
						downloadPromise = _.reduce(manifest.files, downloadFile, downloadPromise);
						downloadPromise = downloadPromise.then(syncEvent("downloadedXacts"));
					}

					return downloadPromise;

					function downloadFile(p, fileDescriptor, idx) {

						return p
							.then(getFile)
							.then(extractFile);

						function getFile() {
							logFileToDownload(fileDescriptor);
							return AH.notify(Message.getMessage(Constants.messageCodes.downloadingFile, idx + 1, manifest.files.length),
								server.getFile(fileDescriptor, {
									maxNumTransactions: options.downloadXactsSizeLimit
								}, options.timeout));
						}

						function extractFile(mtc) {
							logMessage("Extracting '" + fileDescriptor.fileName + "' (" + JSON.stringify(mtc).length + " bytes)...");
							var extractionPromise = domain.extractMtc(mtc)
								.then(function () {
									return downloadSegmentedFiles(mtc);
								})
								.then(function () {
									server.fileToAcknowledge = fileDescriptor.mailboxId;
								});

							return AH.notify(Message.getMessage(Constants.messageCodes.extractingFile, idx + 1, manifest.files.length), extractionPromise);
						}
					}
				}

				// ## downloadSegmentedFiles(mtc)
				//
				// Requests all segments, in a given MTC, from the server.
				//
				// Returns a promise that is resolved when all segments have been downloaded
				// and written them to the domain's **Incoming** folder
				//

				function downloadSegmentedFiles(mtc) {

					var segmentedFiles = _.where(mtc.files, { type: "Segmented" });

					return _.reduce(segmentedFiles, downloadSegmentedFile, AH.resolve());

					function downloadSegmentedFile(prevFile, file) {
						var segment = {
							mailboxId: mtc.descriptor.mailboxId,
							segmentFileName: file.fileName,
							segmentFileType: file.segmentFileType
						};
						return _.reduce(_.range(1, file.segmentCount + 1), function (prevSegment, idx) {
							return prevSegment.then(function () {
								return downloadFileSegment(idx);
							});
						}, prevFile);

						function downloadFileSegment(idx) {
							segment.segmentIndex = idx;

							logMessage("Downloading '" + segment.segmentFileName + "' (" + segment.segmentFileType + ") [" + segment.segmentIndex + "]...");

							var segmentPromise = server.getSegment(segment, options.timeout)
								.then(function (segmentMtc) {
									return domain.extractMtc(segmentMtc);
								});

							return AH.notify(Message.getMessage(Constants.messageCodes.downloadingSegment, idx, file.segmentCount), segmentPromise);
						}
					}
				}

				function extractIncoming() {
					return domain.extractIncoming();
				}

				// ## Logging functions

				function emphasize(msg) {
					return "### " + msg + " ###";
				}

				function logSyncStarted() {
					logMessage(emphasize("Sync started"));
				}

				function logFileToUpload(fileInfo) {
					logMessage("Uploading '" + fileInfo.name + "' (" + fileInfo.size + " bytes)...");
				}

				function logRequestFiles() {
					logMessage("Requesting file list...");
				}

				function logFilesToDownload(count) {
					logMessage(count + " file(s) to download:");
				}

				function logFileToDownload(fileDescriptor) {
					logMessage("Downloading '" + fileDescriptor.fileName + "' (" + fileDescriptor.type + ")...");
				}

				function logSyncCompleted() {
					logMessage(emphasize(AH.format("Sync completed ({0}s)", getSyncTime(msStart))));
				}

				function handleSyncFailed(err) {
					// inject "Sync Failed" into the error message
					var duration = getSyncTime(msStart);
					var msgFormat = "Sync failed ({0}s): {1}";

					if (err instanceof Error) {
						AH.normalizeWebSqlError(err);
						err.message = AH.format(msgFormat, duration, err.message);
					} else {
						err = new Error(AH.format(msgFormat, duration, err));
					}

					logMessage(emphasize(err.message));
					return AH.reject(err);
				}

			});

			syncPromise.always(function () {
				syncing = false;
			});

			return syncPromise;
		}

		function logAuthenticating() {
			logMessage("Authenticating " + domain.domInfo.user() + "@" + domain.domInfo.name() + "...");
		}

		function logDisconnect() {
			logMessage("Disconnecting...");
		}

		function logMessage(message) {
			domain.logMessage(message);
		}

		function getSyncTime(msStart) {
			var msEnd = (new Date()).valueOf();
			return ((msEnd - msStart) / 1000).toFixed(1);
		}

		function processIncomingFiles() {
			return domain.processIncomingFiles();
		}

		function prepareOutgoingFiles() {
			return domain.prepareOutgoingFiles();
		}

		function checkNetworkConnection() {
			if (!AH.isOnline()) {
				throw new MdoError("No network available", Constants.errorCodes.offline);
			}
		}

		function uploadVaultFiles(timeout) {
			return vaultSync && vaultSync.uploadVaultFiles(timeout);
		}

		function downloadVaultFiles(timeout) {
			return vaultSync && vaultSync.downloadVaultFiles(timeout);
		}

		/**
		 * @method testUserCredentials
		 *
		 * Test user credentials on the server.
		 *
		 * @param {Object} credentials
		 *
		 * @param {String} credentials.user
		 * @param {String} credentials.password
		 *
		 * @returns {Promise}
		 *
		 * Resolves if credentials are valid, rejects otherwise.
		 */
		function testUserCredentials(credentials) {

			// Set basic credentials
			credentials = {
				domainId: domain.domInfo.id(),
				userId: domain.domInfo.userId(),
				password: credentials.password
			};

			if (domain.domInfo.device()) {
				// Add device sharing info
				credentials.deviceSharing = Constants.deviceSharing.existingUser;
				// Include pass-through user name
				credentials.user = domain.domInfo.user();
			}

			return AH.deferredTryCatch(function () {
				internal.checkNetworkConnection();
				var server = new Server(domain.domInfo.serverUrl(), function() { return credentials; });
				logAuthenticating();
				return server.session()
					.then(logDisconnect);
			});
		}

		internal = {
			processIncomingFiles: processIncomingFiles,
			prepareOutgoingFiles: prepareOutgoingFiles,
			checkNetworkConnection: checkNetworkConnection,
			downloadVaultFiles: downloadVaultFiles,
			uploadVaultFiles: uploadVaultFiles
		};

		exports = _.extend({
			sync: sync,
			testUserCredentials: testUserCredentials,
			_internal: internal
		}, AsyncEvents);

		return exports;
	};
});
// MDO/Connection

/**
 * @class MDO.Connection
 *
 * Connection to an installed M-Tier datastore.
 *
 * Created via {@link MDO.Client#createConnection}.
 */

// It wraps access to MDO/Domain and MDO/Datastore
//
// ## Instance methods and properties:
//
//	* `open(user, password)`: Locally authenticates credentials and changes connection to `opened` state
//	* `close()`: Changes connection to `closed` state.
//	* `createElement(className)`: Create a new MDO Element of the specified `className`
//	* `createCollection(className)`: Create a new MDO Collection of the specified `className`
//	* `state`: Returns the connection state ('closed' or 'opened').
//	* `model`: Returns the data model.  Throws an error if connection is not open.
//	* `database`: Returns the WebSQL database. Throws an error if connection is not open.
//
define('MDO/Connection',[
	"underscore",
	"backbone",
	"AH",
	"Constants",
	"./Error",
	"./Element",
	"./FileElement",
	"./Collection",
	"Http/FileServer",
	"Logging/logger",
	"./AsyncEvents",
	"./Synchronizer"
], function (
	_,
	Backbone,
	AH,
	Constants,
	MdoError,
	MdoElement,
	MdoFileElement,
	MdoCollection,
	FileServer,
	logger,
	AsyncEvents,
	MdoSynchronizer
	) {

	"use strict";

	/**
	 * @constructor
	 *
	 *
	 * @param {MDO.Domain} dom
	 * Domain to connect to.
	 *
	 * @param {MDO.DataStore} ds
	 * DataStore to connect to.
	 *
	 * @param {MDO.Client} client
	 * MDO client creating this connection; used to resolve the circular dependency between Client and Connection.
	 *
	 */
	return function (dom, ds, client) {

		var _password;
		var exports = {};
		var _internal = {
			synchronizer: new MdoSynchronizer(dom, exports),
			domInfo: dom.domInfo,
			isCurrentPassword: function (password) {
				return password === _password;
			},
			datastore: ds,
			domain: dom,
			getFileServer: getFileServer
		};

		var state;
		var promise;
		var eltConstructors = {};
		var colConstructors = {};
		// base constructor caches
		var BaseConnectionElement;
		var BaseConnectionFileElement;
		var BaseConnectionCollection;

		Object.defineProperties(_internal, {
			BaseConnectionElement: { get: function() { return BaseConnectionElement; } },
			BaseConnectionCollection: { get: function() { return BaseConnectionCollection; } }
		});

		/**
		* @method open
		* Opens the connection using the optional credentials and changes its state to `opened` or `privileged`.
		*
		* If connection is already open, its state can be elevated or lowered depending on whether
		* valid credentials were supplied.
		*
		* ## Usage
		*
		* ### Opening a privileged connection
		*
		*		var connection = mdoCon.open(user, password).then(function(mdoConnection) {
		*				//Logs "Connection is privileged"
		*				mdoConnection.logMessage("Connection is " + mdoConnection.getState());
		*		});
		*
		*
		* ### Opening an unprivileged connection
		*
		*		var connection = mdoCon.open().then(function(mdoConnection) {
		*			//Logs "Connection is open"
		*			mdoConnection.logMessage("Connection is " + mdoConnection.getState());
		*		});
		*
		* @param {String=} [user]
		*
		* @param {String=} [password]
		*
		* @returns {Promise.<MDO.Connection>}
		* Resolves with the MDO.Connection if credentials were valid or not specified
		* and rejects if credentials were invalid.
		*
		* @async
		*/
		function open(user, password) {
			var statePromise;
			var self = this;
			if (_.isUndefined(user)) {
				password = undefined;
				statePromise = AH.resolve(Constants.connectionStates.opened);
			} else if (dom.domInfo.testCredentials(user, password)) {
				statePromise = AH.resolve(Constants.connectionStates.privileged);
			} else if (dom.domInfo.user() !== user) {
				return AH.reject(new MdoError("Invalid user credentials", Constants.errorCodes.invalidCredentials));
			} else {
				// User name unchanged, but local credential test failed
				statePromise = _internal.synchronizer.testUserCredentials({
					password: password
				}).then(function () {
					dom.domInfo.saveCredentials(user, password);
					return Constants.connectionStates.privileged;
				}, function (err) {
					if (err.mdoCode === Constants.errorCodes.offline) {
						return AH.reject(new MdoError("Invalid local user credentials", Constants.errorCodes.invalidLocalCredentials));
					}
					return AH.reject(new MdoError("Invalid user credentials", Constants.errorCodes.invalidCredentials));
				});
			}

			return statePromise.then(function(newState) {

				clearCachedCtors();

				// init constructor cache for MdoElement and MdoCollection
				BaseConnectionElement = MdoElement.extend({
					_mdoCon: self
				});

				BaseConnectionFileElement = MdoFileElement.extend({
					_mdoCon: self
				});

				BaseConnectionCollection = MdoCollection.extend({
					_mdoCon: self
				});

				var dfd = AH.defer();
				AH.when(state !== Constants.connectionStates.closed || ds.open(), function () {
					setPassword(password);
					state = newState;

					// Start proxying events from domain
					exports.listenTo(dom, Constants.connectionEvents.dataReset, function () {
						exports.onDataUpdated(Constants.connectionEvents.dataReset);
					});

					// Start proxying events from synchronizer
					exports.listenTo(_internal.synchronizer, "all", function(name, options) {
						return exports.asyncTrigger(name, exports, options);
					});

					// Start proxying events from datastore
					exports.listenTo(ds, "processingXacts", _.bind(exports.asyncTrigger, exports, Constants.connectionEvents.syncProcessingXacts, exports));
					exports.listenTo(ds, "processedXacts", _.bind(exports.asyncTrigger, exports, Constants.connectionEvents.syncProcessedXacts, exports));

					return dfd.resolve(self);
				}, function () {
					return dfd.reject(new Error("Failed to open connection"));
				});

				return (promise = dfd.promise);
			});
		}

		/**
		 * @method close
		 * Closes the connection. Changes the {@link MDO.Connection#state state} to {@link Constants.ConnectionState#closed closed}
		 */
		function close() {
			state = Constants.connectionStates.closed;
			clearCachedCtors();

			// Stop proxying events
			exports.stopListening(_internal.synchronizer);
			exports.stopListening(dom);
			exports.stopListening(ds);

			promise = AH.reject(new Error("MDO connection is closed"));
		}

		/**
		 * @private
		 * Clear cached element/collection constructors
		 */
		function clearCachedCtors() {
			BaseConnectionElement = undefined;
			BaseConnectionFileElement = undefined;
			BaseConnectionCollection = undefined;
			eltConstructors = {};
			colConstructors = {};
		}

		function setPassword(password) {
			_password = password;
			dom.serverPassword = password;
		}

		/**
		 * @method getState
		 * Current state of the connection.
		 *
		 * @returns {Constants.ConnectionState}
		 */
		function getState() {
			return state;
		}

		/**
		 * @method createElement
		 * Creates a new MDO Element of the specified `className`
		 *
		 * @param {String} className
		 * Model Class name.
		 *
		 * @returns {MDO.Element}
		 *
		 * @throws {Error}
		 * Fails if an invalid `className` is specified.
		 *
		 */
		function createElement(className) {

			throwIfClosed("createElement()");

			ds.validateClassName(className);

			var Ctor = getElementCtor(className, this);

			return new Ctor({});
		}

		/**
		 * @method createCollection
		 * Creates a new MDO Collection of the specified `className`
		 *
		 * @param {String} className
		 *
		 * Model Class name.
		 *
		 * @returns {MDO.Collection}
		 *
		 * @throws {Error}
		 * Fails if an invalid `className` is specified.
		 */

		function createCollection(className) {

			throwIfClosed("createCollection()");

			ds.validateClassName(className);

			var Ctor = getCollectionCtor(className, this);

			return new Ctor();
		}

		/**
		 * @method throwIfClosed
		 * @private
		 * Throws an exception unless connection is open
		 *
		 * @param {string} action
		 * The action being taken on the connection
		 *
		 * @throws {Error}
		 * 'MDO connection not open during &lt;action%gt;'
		 */
		function throwIfClosed(action) {
			if (state === Constants.connectionStates.closed) {
				throw new Error("MDO connection not opened during " + action);
			}
		}

		/**
		 * @method rejectIfClosed
		 * @private
		 * Returns a promise that rejects with a message noting the attempted
		 * action if the connection is closed state.
		 * Otherwise, returns a promise that resolves.
		 *
		 * @param {string} action
		 * The action being taken on the connection.
		 *
		 * @return {Promise}
		 * Rejects unless the connection is open
		 */
		function rejectIfClosed(action) {
			if (state === Constants.connectionStates.closed) {
				return AH.reject(new Error("MDO connection not opened during " + action));
			}

			return AH.resolve();
		}

		/**
		 * @method rejectIfNotPrivileged
		 * @private
		 * Returns a promise that rejects with a message noting the attempted
		 * action if the connection is not in a privledged state.
		 * Otherwise, returns a promise that resolves.
		 *
		 * @param {string} action
		 * The action being taken on the connection.
		 *
		 * @return {Promise}
		 * Rejects unless the connection is privileged
		 */
		function rejectIfNotPrivileged(action) {
			if (state !== Constants.connectionStates.privileged) {
				return AH.reject(new Error("MDO connection not privileged during " + action));
			}

			return AH.resolve();
		}

		/**
		 * @method getElementCtor
		 * @private
		 * Returns the construction function for the specified element class.
		 *
		 * @param {string} className
		 * Name of the class to retrieve the element constructor for.
		 */
		function getElementCtor(className) {

			if (!className) {
				return BaseConnectionElement;
			}

			// Lookup cached constructor function
			var ctor = eltConstructors[className];

			if (!ctor) {
				var modelClass = ds.model.classes.getByName(className);
				var baseClass = modelClass.baseClass;
				var baseCtor = modelClass.isFileClass ? BaseConnectionFileElement : BaseConnectionElement;
				var fields = modelClass.fields;

				// If we have a base class, extend its ctor rather than BaseConnectionElement
				if (baseClass) {
					baseCtor = getElementCtor(baseClass.name);
					// We don't need to create property for ID field
					fields = fields.filter(function (field) {
						return !field.isIdField();
					});
				}

				// Create new constructor derived from baseCtor
				eltConstructors[className] = ctor = baseCtor.extend({
					_class: modelClass,
					idAttribute: modelClass.idField.name,
					_ds: ds
				});

				// Create get/set accessors for fields
				fields.forEach(function (field) {
					var name = field.name;
					Object.defineProperty(ctor.prototype, name, {
						set: function (value) {
							this.set(name, value);
						},
						get: function () {
							return this.get(name);
						}
					});
				});
			}

			return ctor;
		}

		/**
		 * @method getCollectionCtor
		 * @private
		 * Returns the construction function for the specified element class.
		 *
		 * @param {string} className
		 * Name of the class to retrieve the collection constructor for.
		 */
		function getCollectionCtor(className) {

			if (!className) {
				return BaseConnectionCollection;
			}

			// Lookup cached constructor function
			var ctor = colConstructors[className];

			if (!ctor) {
				var modelClass = ds.model.classes.getByName(className);
				var baseClass = modelClass.baseClass;
				var baseCtor = BaseConnectionCollection;

				// If we have a base class, extend its ctor rather than BaseConnectionCollection
				if (baseClass) {
					baseCtor = getCollectionCtor(baseClass.name);
				}

				// Create new constructor derived from baseCtor
				colConstructors[className] = ctor = baseCtor.extend({
					_class: modelClass,
					_ds: ds,
					model: getElementCtor(className)
				});
			}

			return ctor;
		}

		/**
		 * @method sync
		 * Synchronizes data with the server.
		 *
		 * @param [options]
		 *
		 * @param {string} [options.password]
		 * Password to use during server authentication.  Password will be persisted if sync succeeds.
		 *
		 * @param {boolean} [options.uploadXacts=true]
		 * Upload transactions to server.
		 *
		 * @param {boolean} [options.downloadXacts=true]
		 * Download transactions from server.
		 *
		 * @param {boolean} [options.processXacts=true]
		 * Process downloaded server transactions.
		 *
		 * @param {boolean} [options.downloadXactsSizeLimit=5000]
		 * Break down downloaded data to segments of this size.
		 *
		 * @param {boolean} [options.uploadFiles=true]
		 * Upload file attachments to the server.
		 * By default, file attachments that have been created or modified on the device are
		 * uploaded to the server during synchronization.
		 * Setting this option to `false` will skip the uploading of file attachments.
		 *
		 * @param {boolean} [options.downloadFiles=true]
		 * Download file attachments from the server.
		 * By default, file attachments that have been created or modified on the server are
		 * downloaded during synchronization.
		 * Setting this option to `false` will skip the downloading of file attachments.
		 *
		 * @param {number} [options.timeout=120000]
		 * Duration in milliseconds to wait between operations before the Connection considers the sync to have timedout.
		 *
		 * @returns {Promise.<MDO.Connection>}
		 * Resolves with the connection after synchronization with the server completes.
		 *
		 * @message {@link Constants.MessageCode#applyingServerChanges ApplyingServerChanges}
		 *
		 * @message {@link Constants.MessageCode#preparingUpload PreparingUpload}
		 *
		 * @message {@link Constants.MessageCode#extractingFile ExtractingFile}
		 *
		 * @message {@link Constants.MessageCode#resettingDatabase ResettingDatabase}
		 *
		 * @message {@link Constants.MessageCode#deployingDatabase DeployingDatabase}
		 *
		 * @message {@link Constants.MessageCode#uploadingFile UploadingFile}
		 *
		 * @message {@link Constants.MessageCode#downloadingFile DownloadingFile}
		 *
		 * @message {@link Constants.MessageCode#downloadingSegment DownloadingSegment}
		 *
		 * @message {@link Constants.MessageCode#checkingForAttachmentDownloads CheckingForAttachmentDownloads}
		 *
		 * @message {@link Constants.MessageCode#checkingForAttachmentUploads CheckingForAttachmentUploads}
		 *
		 * @message {@link Constants.MessageCode#downloadingVaultFiles DownloadingVaultFiles}
		 *
		 * @message {@link Constants.MessageCode#downloadingVaultFile DownloadingVaultFile}
		 *
		 * @message {@link Constants.MessageCode#uploadingVaultFiles UploadingVaultFiles}
		 *
		 * @message {@link Constants.MessageCode#uploadingVaultFile UploadingVaultFile}
		 *
		 * @message {@link Constants.MessageCode#authenticating Authenticating}
		 *
		 * @message {@link Constants.MessageCode#disconnecting Disconnecting}
		 *
		 * @message {@link Constants.MessageCode#requestingFiles RequestingFiles}
		 *
		 * @async
		 */
		function sync(options) {
			var self = this;
			var stateIsValid;
			var modelVersion = ds.model ? ds.model.version : undefined;

			if (state === Constants.connectionStates.opened && options && "password" in options) {
				// Sync will use option.password
				stateIsValid = true;
			} else {
				stateIsValid = rejectIfNotPrivileged("sync()");
			}

			return AH.when(stateIsValid, function () {
				options = _.extend({ password: _password }, options);
				if (dom.domInfo.device()) {
					options.deviceSharing = Constants.deviceSharing.existingUser;
				} else {
					delete options.deviceSharing;
				}
				return _internal.synchronizer.sync(options);
			}).then(function () {
				if (options.password !== _password) {
					// Persist credentials
					dom.domInfo.saveCredentials(dom.domInfo.user(), options.password);
					setPassword(options.password);
					// elevate privilege
					state = Constants.connectionStates.privileged;
				}
				if (modelVersion !== ds.model.version) {
					self.onModelUpdated(Constants.connectionEvents.modelChanged);
				}
				self.onDataUpdated(Constants.connectionEvents.dataSynced);
			}).then(function () {
				return self;
			});
		}

		/**
		 * @async
		 * @method executeServerRpc
		 *
		 * Executes an anonymous or authenticated RPC against the server with which this client was colonized; If the
		 * connection is currently *opened* and *privileged*, then the RPC will be authenticated with the same
		 * credentials used to open the connection.
		 *
		 * @param {string} methodName
		 * Name of the RPC to invoke on the server
		 *
		 * @param {Object} parameters
		 * Parameters to pass to the RPC
		 *
         * @param {Object} [options]
		 * Options to control how the device communicates with the server to invoke the RPC.
		 *
		 * @param {number} [options.timeout=120000]
		 * Maximum duration to wait for the server to respond to our call.
		 *
		 * @param {number} [options.authTimeout=30000]
		 * Maximum duration to wait for the server to authenticate us.
		 *
		 * @returns {Promise}
		 * A promise that resolves with the response from the RPC, or an error containing the rejection reason and a
		 * has of any other custom data that the RPC returned about the error.
         */
		function executeServerRpc(methodName, parameters, options) {
			options = _.extend({ server: ds.server._httpServer }, options);
			if (state === Constants.connectionStates.privileged) {
				return withServerSession(function () {
					return client.executeServerRpc(methodName, parameters, options);
				}, options.authTimeout);
			}
			return client.executeServerRpc(methodName, parameters, options);
		}

		/**
		 * @event sync_preparingUploadXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ uploadXacts: true }` is about to
		 * prepare transactions to be uploaded to the server.
		 *
		 * The event handler can modify and save MDO elements and these transactions will be included in the upload.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncPreparingUploadXacts syncPreparingUploadXacts}, function(mdoCon) {
		 *         var mdoCol = mdoCon.createCollection("AH_Work");
		 *         mdoCol.queryFilter("$ahStatus = ?", ["READY"]);
		 *         // Return promise
		 *         return mdoCol.fetch()
		 *             .then(function(mdoCol) {
		 *                 mdoCol.forEach(function(mdoElt) {
		 *                     mdoElt.ahStatus = "POSTED";
		 *                 });
		 *                 return mdoCol.saveAllElements();
		 *             })
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_uploadingXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ uploadXacts: true }` and preparing
		 * upload transactions resulted in one or more that need to be uploaded to the server.
		 *
		 * The event handler should not be modifying MDO elements.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncUploadingXacts syncUploadingXacts}, function(mdoCon) {
		 *         ...
		 *         // Return a promise
		 *         return promise;
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_uploadedXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ uploadXacts: true }` and
		 * successfully uploaded local transactions to the server.
		 *
		 * The event handler should not be modifying MDO elements.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncUploadedXacts syncUploadedXacts}, function(mdoCon) {
		 *         ...
		 *         // Return a promise
		 *         return promise;
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_downloadingXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ downloadXacts: true }` and
		 * the server has transaction files available for download
		 *
		 * The event handler should not be modifying MDO elements.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncDownloadingXacts syncDownloadingXacts}, function(mdoCon) {
		 *         ...
		 *         // Return a promise
		 *         return promise;
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_downloadedXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ downloadXacts: true }` and
		 * successfully downloaded transactions from the server.
		 *
		 * The event handler should not be modifying MDO elements.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncDownloadedXacts syncDownloadedXacts}, function(mdoCon) {
		 *         ...
		 *         // Return a promise
		 *         return promise;
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_processingXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ processXacts: true }` and
		 * the are server transactions available to be processed
		 *
		 * The event handler should not be modifying MDO elements.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncProcessingXacts syncProcessingXacts}, function(mdoCon) {
		 *         ...
		 *         // Return a promise
		 *         return promise;
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @event sync_processedXacts
		 * @async
		 *
		 * This event is fired when the {@link #sync sync} method, called with `{ processXacts: true }` and
		 * has successfully processed all server transactions.
		 *
		 * The event handler can modify and save MDO elements, performing post-processing work.
		 *
		 * **Note:** The sync operation will wait on the promise returned by the event handler before proceeding with the sync.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#syncProcessedXacts syncProcessedXacts}, function(mdoCon) {
		 *         var mdoCol = mdoCon.createCollection("AH_Work");
		 *         mdoCol.queryFilter("$ahStatus = ?", ["POSTED"]);
		 *         // Return promise
		 *         return mdoCol.destroyAllElements({ localOnly: true });
		 *     });
		 *
		 * @param {MDO.Connection} connection
		 *
		 * Connection performing the sync.
		 */

		/**
		 * @method onModelUpdated
		 * @private
		 * Triggers the 'model' event with the specified type and model
		 *
		 * @param {Constants.ConnectionEvent} type
		 * Type of the Model update
		 */
		function onModelUpdated(type) {
			switch (type) {
				/**
				 * @event model_changed
				 *
				 * A new model was installed.
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#modelChanged modelChanged}, function(model) {
				 *         alert('The model was changed!');
				 *     });
				 *
				 * @param {DataModel.Model} model
				 * New model
				 */
				case Constants.connectionEvents.modelChanged:
					this.trigger(Constants.connectionEvents.modelChanged, ds.model);
					break;
				default:
					throw new Error("Unsupported model update type: " + type);
			}
		}

		/**
		 * @method onDataUpdated
		 * @private
		 * Triggers the 'data' event with the specified type and optional element and/or optional flags
		 *
		 * @param {Constants.ConnectionEvent} type
		 * Type of the data update.
		 *
		 * @param {MDO.Element} element
		 * The element that was updated.
		 *
		 * @param {Object} [options]
		 * Options related to how the update occured
		 */
		function onDataUpdated(type, element, options) {

			if (options && options.silent) {
				// Suppress events
				return;
			}

			switch (type) {
				/**
				 * @event data_added
				 *
				 * This event is fired whenever a new MDO.Element was inserted into the datastore by calling the
				 * {@link MDO.Element#save save} method on a new element created by this connection.
				 *
				 * <em>Note: This event is not fired when {@link MDO.Element#save element.save()} method is called with the `{ silent: true }` option.</em>
				 *
				 * <em>Note: Elements created by other connections and elements created by the synchronization process do not
				 * trigger this event.</em>
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#dataAdded dataAdded}, function(mdoElt) {
				 *         alert('An MDO Element was added!');
				 *     });
				 *
				 * @param {MDO.Element} element
				 * Inserted element
				 */
				case Constants.connectionEvents.dataAdded:
					this.trigger(Constants.connectionEvents.dataAdded, element);
					break;

				/**
				 * @event data_modified
				 *
				 * This event is fired whenever an existing MDO.Element was updated in the datastore by calling the
				 * {@link MDO.Element#save save} method on an element that is owned by this connection.
				 *
				 * <em>Note: This event is not fired when {@link MDO.Element#save Element.save()} method is called with the `{ silent: true }` option.</em>
				 *
				 * <em>Note: Elements modified by other connections and elements modified by the synchronization process do not
				 * trigger this event.</em>
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#dataModified dataModified}, function(mdoElt, options) {
				 *         alert('An MDO Element was modified!');
				 *     });
				 *
				 * @param {MDO.Element} element
				 * The element that was modified
				 *
				 * @param {Object} options
				 * A map of flags specified when updating this element
				 *
				 * @param {Boolean} options.resolve
				 * `true` if this element was {@link MDO.Element#resolve resolved}
				 *
				 * @param {Boolean} options.localOnly
				 * `true` if no transactions were generated for this update; The changes made to this element
				 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs
				 */
				case Constants.connectionEvents.dataModified:
					this.trigger(Constants.connectionEvents.dataModified, element, options);
					break;

				/**
				 * @event data_deleted
				 *
				 * This event is fired whenever an existing MDO.Element was deleted from the datastore by calling the
				 * {@link MDO.Element#method-destroy destroy} method on an element that is owned by this connection.
				 * Deleting an element will first fire `data_deleted` events for any elements owned by the deleted element.
				 *
				 * <em>Note: This event is not fired when the {@link MDO.Element#method-destroy Element.destroy()}
				 * method is called with the `{ silent: true }` option.</em>
				 *
				 * <em>Note: Elements deleted by other connections and elements deleted by the synchronization process do not
				 * trigger this event.</em>
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#dataDeleted dataDeleted}, function(mdoElt, options) {
				 *         alert('An MDO Element was deleted! - ' + mdoElt.modelClass.name + ' ' + mdoElt.PKey);
				 *     });
				 *
				 * @param {MDO.Element} element
				 * The element that was deleted.  Only the id (`PKey`) field is set with all other fields `undefined`.
				 *
				 * @param {Object} options
				 * A map of flags specified when deleting this element
				 *
				 * @param {Boolean} options.localOnly
				 * `true` if no transactions were generated for this delete; The removal this element
				 * will not be uploaded to M-Tier when the next {@link MDO.Connection#sync sync} occurs
				 */
				case Constants.connectionEvents.dataDeleted:
					// Note: element contains [{modelClass, id}]
					_.forEach(element, function(deletedItem) {
						var deletedElt = this.createElement(deletedItem.modelClass.name);
						deletedElt[deletedItem.modelClass.idField.name] = deletedItem.id;
						deletedElt._state = Constants.elementStates.deleted;
						this.trigger(Constants.connectionEvents.dataDeleted, deletedElt, options);
					}, this);
					break;

				/**
				 * @event data_synced
				 *
				 * This event is fired whenever the datastore has finished synchronizing with the M-Tier server, usually as a result
				 * of calling the #sync method. All Collections and Elements should be {@link MDO.Element#resolve resolved} again to
				 * ensure that they reflect the current state of the datastore.
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#dataSynced dataSynced}, function() {
				 *         alert('Sync completed!');
				 *     });
				 *
				 * @param {MDO.Connection} connection
				 * The connection which just finished syncing with the server
				 */
				case Constants.connectionEvents.dataSynced:
					this.trigger(Constants.connectionEvents.dataSynced, this);
					break;

				/**
				 * @event data_reset
				 *
				 * This event is fired whenever the datastore has been reset, usually as a result of a data repost or recolonization
				 * during a #sync. All Collections and Elements should be {@link MDO.Element#resolve resolved} again to ensure that
				 * they still exist and reflect the current state of the datastore.
				 *
				 * <em>Note: Existing unresolved (negative) tempIDs are no longer valid!</em>
				 *
				 * ## Usage:
				 *
				 *     mdoCon.on(Constants#connectionEvents.{@link Constants.ConnectionEvent#dataReset dataReset}, function(connection) {
				 *         alert('Data was reset!');
				 *     });
				 *
				 * @param {MDO.Connection} connection
				 * The connection which had its data reset
				 */
				case Constants.connectionEvents.dataReset:
					this.trigger(Constants.connectionEvents.dataReset, this);
					break;

				default:
					throw new Error("Unsupported data update type: " + type);
			}

			this.trigger("data");
		}

		// ### logMessage(message, [options])

		/**
		 * @method logMessage
		 *
		 * Logs a message in the MDO message log
		 *
		 * @param {String} message
		 *
		 * Message to log.
		 *
		 * @param [options]
		 *
		 * Additional options for the operation.
		 *
		 * @param {String} [options.appId]
		 *
		 * The id of the application logging the message
		 *
		 * @param {String} [options.category]
		 *
		 * The category (e.g. `"Error"`, `"Warning"`, etc.) of the message being logged
		 *
		 * @returns {Promise}
		 *
		 * Resolves when the message has been logged
		 *
		 * @async
		 */

		function logMessage(message, options) {
			return logger.log(message, _.extend({}, options, { domainId: dom.domInfo.id() }));
		}

		// ### logError(error, [options])

		/**
		 * @method logError
		 *
		 * Logs the specified `error` in the MDO message log
		 *
		 * @param {Error} error
		 *
		 * Error to log.
		 *
		 * @param [options]
		 *
		 * Additional options for the operation.
		 *
		 * @param {String} [options.appId]
		 *
		 * The id of the application logging the message
		 *
		 * @param {String} [options.category]
		 *
		 * The category (e.g. `"Error"`, `"Warning"`, etc.) of the message being logged
		 *
		 * @returns {Promise}
		 *
		 * Resolves when the message has been logged
		 *
		 * @async
		 *
		 */
		function logError(error, options) {
			return logger.logError(error, _.extend({}, options, { domainId: dom.domInfo.id() }));
		}

		/**
		 * @method mdoTransaction
		 *
		 * Executes and wraps mdo operations within a `callback` into a single M-Tier and database transaction.
		 *
		 * ## Usage:
		 *
		 *		mdoCon.mdoTransaction(function(mdoConnection) {
		 *			var promises = [];
		 *
		 *			// Create an element
		 *			var mdoEltNew = mdoConnection.createElement(...);
		 *			promises.push(mdoEltNew.save());
		 *
		 *		    // Delete multiple elements
		 *			_.each(mdoElts, function(mdoElt) {
		 *				promises.push(mdoElt.destroy());
		 *			});
		 *
		 *			// Update an existing element
		 *			mdoEltOp.ahStatus = "COMPLETED";
		 *			promises.push(mdoEltOp.save());
		 *
		 *			// Return promise that resolves when all pending operations are completed
		 *			return MDO.whenAll(promises);
		 *		});
		 *
		 * @param {Function} callback
		 * @param {MDO.Connection} callback.mdoCon
		 * @param {Promise} callback.return
		 *
		 * Function called within the scope of an M-Tier and database transaction.
		 * The `callback` must return a {@link Promise} that resolves when all mdo/database operations have completed.
		 *
		 * @returns {Promise}
		 *
		 * Resolves when the transaction is finished.
		 *
		 * @async
		 */
		function mdoTransaction(callback) {
			if (!_.isFunction(callback)) {
				return AH.reject(new Error("No mdo transaction callback was specified"));
			}

			callback = _.bind(callback, null, this);

			return rejectIfClosed("mdoTransaction()")
				.then(executeMdoTransaction);

			function executeMdoTransaction() {
				return ds.mdoTransaction(callback);
			}
		}

		/**
		 * @method getFileServer
		 * @private
		 * Returns an instance of FileServer using current user credentials.
		 *
		 * @return {Http.FileServer}
		 * Instance of FileServer using current user credentials
		 */
		function getFileServer() {
			var domInfo = dom.domInfo;
			var dsInfo = ds.dsInfo;

			// ServerUrl is "{...}/MTierData/" or "MTierData/" - mdo.install() ensures a trailing slash.
			// So we simply need to replace last segment in the URL
			var serverUrl = domInfo.serverUrl();
			var fileServerUrl = serverUrl.replace(/[^\/]*\/$/, "MTierServices/FileTransfer.aspx");

			return new FileServer({
				domain: domInfo.name(),
				datastore: dsInfo.name(),
				sharedDevice: Boolean(domInfo.device()),
				deviceId: domInfo.device() || domInfo.user(),
				user: domInfo.user(),
				password: _password,
				baseUrl: fileServerUrl
			});
		}

		/**
		 * @method extendElement
		 *
		 * Extends the prototype of {@link MDO.Element}s of the given class using the properties
		 * objects with priority given to properties defined on the right most objects.
		 *
		 * When no `className` is specified, extends the base prototype of all {@link MDO.Element}s.
		 *
		 * ## Usage:
		 *
		 *     mdoCon.extendElement("AH_WorkJournal", {
		 *         accept: function (mdoWorkOrder) {
		 *             this.ahWorkOrderRefKey = mdoWorkOrder.id;
		 *             this.ahOldValue = mdoWorkOrder.WorkStatus;
		 *             ...
		 *             this.ahValue = "ACCEPTED";
		 *             this.ahProcessStatus = this.xactStatus.posted;
		 *         },
		 *
		 *         complete: function (mdoWorkOrder) {
		 *             this.ahWorkOrderRefKey = mdoWorkOrder.id;
		 *             this.ahOldValue = mdoWorkOrder.WorkStatus;
		 *             ...
		 *             this.ahValue = "COMPLETE";
		 *             this.ahProcessStatus = this.xactStatus.posted;
		 *         },
		 *
		 *         xactStatus: {
		 *             processed: "PROCESSED",
		 *             submitted: "SUBMITTED",
		 *             posted: "POSTED"
		 *         }
		 *     });
		 *
		 *     ...
		 *
		 *     function acceptWorkOrder(mdoWorkOrder) {
		 *         var mdoWorkJournal = mdoCon.createElement("AH_WorkJournal");
		 *         mdoWorkJournal.accept(mdoWorkOrder);
		 *         return mdoWorkJournal.save();
		 *     }
		 *
		 * @param {String} [className]
		 *
		 * Model Class name.
		 *
		 * @param {Object} [properties]
		 *
		 * Objects whose properties will be added to the {@link MDO.Element}.
		 *
		 * @returns {Object}
		 *
		 * Returns the prototype of the {@link MDO.Element} for the given {@link DataModel.Class} name.
		 *
		 * @throws {Error}
		 *
		 * Fails if an invalid `className` is specified.
		 *
		 */
		function extendElement(className) {
			if (className) {
				ds.validateClassName(className);
			}
			var mdoElePrototype = getElementCtor(className).prototype;
			/*
				_.extend takes any number of arguments and uses the first arg as the "destination" object

				function.apply takes an object that the function will be called on and an array to use as
				the arguments for that function.

				We are wrapping our mdoElement prototype in an array so that we can concatenate any
				properties objects to the end of this new array which is used by function.apply to call
				_.extend. In this way we are calling _.extend(mdoElePrototype, properties1, properties2, ..., propertiesN).
			*/
			var args = _.toArray(arguments).slice(1);
			_.extend.apply(null, [mdoElePrototype].concat(args));

			// If no class name specified, we also need to extend BaseConnectionFileElement
			// because it is NOT derived from BaseConnectionElement
			if (!className) {
				_.extend.apply(null, [BaseConnectionFileElement.prototype].concat(args));
			}
			return mdoElePrototype;
		}

		/**
		 * @method extendCollection
		 *
		 * Extends the prototype of {@link MDO.Collection}s of the given class using the properties
		 * objects with priority given to properties defined on the right most objects.
		 *
		 * When no `className` is specified, extends the base prototype of all {@link MDO.Collection}s.
		 *
		 * ## Usage:
		 *
		 *     var proto = mdoCon.extendCollection("AH_PoLineItem", {
		 *         // Add "getTotal()" method to AH_PoLineItem collections
		 *         getTotal: function () {
		 *             var total = 0;
		 *             // Iterate over elements in collection
		 *             this.forEach(function(item) {
		 *                 total += item.ahUnitPrice * item.ahOrderedQty;
		 *             });
		 *             return total;
		 *         },
		 *         ...
		 *     });
		 *
		 *     // Add "total" property to AH_PoLineItem collections
		 *     Object.defineProperty(proto, "total", {
		 *         get: function() { return this.getTotal(); }
		 *     });
		 *
		 *     ...
		 *
		 *     function displayTotal_1(mdoLineItems) {
		 *         alert( mdoLineItems.getTotal() );
		 *     }
		 *
		 *     function displayTotal_2(mdoLineItems) {
		 *         alert( mdoLineItems.total );
		 *     }
		 *
		 * @param {String} [className]
		 *
		 * Model Class name.
		 *
		 * @param {Object} [properties]
		 *
		 * Objects whose properties will be added to the {@link MDO.Collection}.
		 *
		 * @returns {Object}
		 *
		 * Returns the prototype of the {@link MDO.Collection} for the given {@link DataModel.Class} name.
		 *
		 * @throws {Error}
		 *
		 * Fails if an invalid `className` is specified.
		 *
		 */
		function extendCollection(className) {
			if (className) {
				ds.validateClassName(className);
			}
			var mdoColPrototype = getCollectionCtor(className).prototype;
			/*
			_.extend takes any number of arguments and uses the first arg as the "destination" object

			function.apply takes an object that the function will be called on and an array to use as
			the arguments for that function.

			We are wrapping our mdoCollection prototype in an array so that we can concatenate any
			properties objects to the end of this new array which is used by function.apply to call
			_.extend. In this way we are calling _.extend(mdoColPrototype, properties1, properties2, ..., propertiesN).
			*/
			_.extend.apply(null, [mdoColPrototype].concat(_.toArray(arguments).slice(1)));
			return mdoColPrototype;
		}

		/**
		 * @method fieldValueToDb
		 *
		 * Converts a JavaScript value to the representation expected by the database.
		 *
		 * ## Usage:
		 *
		 *      var mdoCol = mdoCon.createCollection("AH_WorkJournal");
		 *
		 *      mdoCol.queryFilter("$ahStartTs > ?", [ mdoCon.fieldValueToDb("AH_WorkJournal.ahStartTs", date) ]);
		 *
		 * @param {String} fieldInfo
		 *
		 * *ClassName.FieldName* string identifying the model field to use for the conversion.
		 *
		 * @param {*} value
		 *
		 * Value to be converted.  The `value`'s data type must match the specified `fieldInfo`.
		 *
		 * @returns {*}
		 *
		 * Value in the representation expected by the database.
		 *
		 * @throws {Error}
		 *
		 * Fails if an invalid `fieldInfo` or a type-incompatible `value` is specified.
		 *
		 */
		function fieldValueToDb(fieldInfo, value) {
			throwIfClosed("fieldValueToDb");
			var chunks = fieldInfo.split(".", 2);
			var modelClass = ds.model.classes.getByName(chunks.shift(), true);
			var modelField = modelClass.allFields.getByName(chunks.shift(), true);
			return modelField.valueToDb(value);
		}

		/**
		 * @method withServerSession
		 * @async
		 *
		 * Executes a callback within a single authenticated session.
		 * This method can be used to improve performance when executing multiple server operations.
		 *
		 * @param {Function} callback
		 *
		 * Callback to execute after authenticating with the server.  The callback should return a {@link Promise}
		 * that resolves when the last server operation has completed.
		 *
		 * @param {number} [authTimeout=30000]
		 *
		 * Duration in milliseconds to wait before Server considers the authentication or disconnect request to have timedout.
		 *
		 * @return {Promise}
		 *
		 * Settles with the same error or value as the callback's returned promise.
		 */
		function withServerSession(callback, authTimeout) {
			if (!_.isFunction(callback)) {
				return AH.reject(new Error("No server session callback was specified"));
			}

			return rejectIfClosed("withServerSession()")
				.then(executeServerRequest);

			function executeServerRequest() {
				return ds.server.session(callback, authTimeout);
			}
		}

		// ## Exports:
		//
		_.extend(exports, {
			open: open,
			close: close,
			getState: getState,
			createElement: createElement,
			createCollection: createCollection,
			sync: sync,
			onDataUpdated: onDataUpdated,
			onModelUpdated: onModelUpdated,
			logMessage: logMessage,
			logError: logError,
			mdoTransaction: mdoTransaction,
			withServerSession: withServerSession,
			extendElement: extendElement,
			extendCollection: extendCollection,
			fieldValueToDb: fieldValueToDb,
			executeServerRpc: executeServerRpc,
			_internal: _internal,

			/**
			 * @readonly
			 *
			 * Promise used while opening the connection.
			 *
			 * Resolves when the MDO.Connection open is successful.
			 */
			promise: function () { return promise; }
		}, AsyncEvents);

		Object.defineProperties(exports, {
			/**
			 * @property {Constants.ConnectionState} state
			 * @readonly
			 *
			 * Current state of this connection. Gets changed when {@link MDO.Connection#open} or  {@link MDO.Connection#close} are called.
			 */
			state: {
				get: function () {
					return state;
				}
			},

			/**
			 * @property {DataModel.Model} model
			 * @readonly
			 *
			 * That data model of the connection's datastore.
			 */
			model: {
				get: function () {
					throwIfClosed("model");
					return ds.model;
				}
			},

			/**
			 * @property {Websql} database
			 * @readonly
			 *
			 * The database used by the connection's datastore.
			 */
			database: {
				get: function () {
					throwIfClosed("database access");
					return ds.store.database;
				}
			}
		});

		// Start in closed state
		close();

		return exports;
	};

});

/**
 * @class MDO.Client
 * @alternateClassName mdo
 * @alternateClassName MDO
 * @singleton
 *
 * Provides access to the local M-Tier domain and datastore.
 *
 * ### Usage Example (non-AMD)
 *
 * Exposed via the `mdo` global variable.
 *
 *     (index.html)
 *
 *     <script src="mdo.js"></script>
 *     <script>
 *         var mdoConnection = mdo.createConnection(...);
 *         ...
 *     </script>
 *
 *
 * ### Usage Example (AMD)
 *
 * Exposed as an anonymous AMD module.
 *
 *     (app.js)
 *
 *     require(["mdo"], function(mdo) {
 *         var mdoConnection = mdo.createConnection(...);
 *         ...
 *     });
 *
 */

define('MDO/Client',[
	"AH",
	"Constants",
	"underscore",
	"backbone",
	"lib/uuid",
	"Http/Config",
	"Http/Server",
	"Messages/Message",
	"./Domain",
	"./Connection",
	"./Synchronizer",
	"./Stats",
	"Logging/logger",
	"./Error"
], function (
	AH,
	Constants,
	_,
	Backbone,
	uuid,
	HttpConfig,
	Server,
	Message,
	MdoDomain,
	MdoConnection,
	MdoSynchronizer,
	MdoStats,
	logger,
	MdoError) {

	"use strict";

	var internal, exports;

	// ### getPrerequisitesError()
	//
	// Returns an Error if prerequisite modules have an old version
	var getPrerequisitesError = _getPrerequisitesError;
	function _getPrerequisitesError() {
		var bbVersion = Backbone.VERSION.split(".");
		var major = Number(bbVersion.shift());

		if (major < 1) {
			return new MdoError("Insufficient prerequisites: MDO requires Backbone version 1.0 or newer - current version is " + Backbone.VERSION, Constants.errorCodes.insufficientPrereqs);
		}

		return undefined;
	}

	/**
	 * @method isDeviceRegistered
	 * Tests whether an MDO domain is currently installed.
	 *
	 * @returns {Object}
	 * If the device is registered the function returns information about the domain.
	 * Otherwise it returns `false`.
	 */
	function isDeviceRegistered() {
		var dom = MdoDomain.retrieve();
		return dom ? dom.domInfo : false;
	}

	/**
	 * @async
	 * @method executeServerRpc
	 *
	 * Executes an anonymous RPC against the Data Sync Service and returns the result
	 *
	 * @param {String} methodName
	 * Name of the RPC to invoke on the server
	 *
	 * @param {Object} parameters
	 * Parameters to pass to the RPC
	 *
	 * @param {Object} [options]
	 * Options to control how the device communicates with the server to invoke the RPC
	 *
	 * @param {String} [options.serverUrl]
	 * URL to the DataSyncService endpoint on the server; By default, the URL used to colonize the device is used.
	 *
	 * @param {Number} [options.timeout=120000]
	 * Maximum duration to wait for the server to respond to our call.
	 *
	 * @returns {Promise}
	 * A promise that resolves with the response from the RPC, or an error containing the rejection reason and a
	 * has of any other custom data that the RPC returned about the error.
	 */
	function executeServerRpc(methodName, parameters, options) {
		if (!methodName || methodName === "") {
			return AH.reject(new MdoError("methodName must be a non-empty string", Constants.errorCodes.invalidArgs));
		}

		var domainInfo = isDeviceRegistered();
		options = _.extend({ serverUrl: domainInfo && domainInfo.serverUrl() }, options);
		parameters = parameters || {};
		var server = options.server || new Server(options.serverUrl);

		return server.execute("DeviceRpc", { methodName: methodName, parameters: parameters }, options.timeout)
					 .then(function(result) { return result.customData; });
	}

	/**
	 * @method registerDevice
	 * Registers the device for the specified users.
	 *
	 * @param {String} serverUrl
	 * URL to the M-Tier DataSync service (usually `/MTierData`)
	 *
	 * @param {String} domainName
	 * Name of the M-Tier Domain
	 *
	 * @param {String} user
	 * Name of the M-Tier User (Device User or Device Account)
	 *
	 * @param {String} password
	 * Password of the M-Tier user.
	 *
	 * @param {Object} [customData]
	 * Optional data passed to the ServerComponent handling device registration.
	 *
	 * @returns {Promise}
	 * Returns a {@link Promise} that resolves when the operation completes.
	 *
	 * @async
	 */
	function registerDevice(serverUrl, domainName, user, password, customData) {

		var promise = normalizeConnectionInfo(serverUrl, domainName, user, password)
			.then(function(conInfo) {
				serverUrl = conInfo.serverUrl;
				var credentials = conInfo.credentials;
				var server = new Server(serverUrl);

				return server.execute("RegisterDevice", _.extend({
					deviceUuid: getDeviceUuid(),
					deviceModel: getDeviceModel(),
					devicePlatform: getDevicePlatform(),
					customData: customData
				}, credentials)).then(function(reply) {
					MdoDomain.create({
						serverUrl: serverUrl,
						domain: credentials.domain,
						domainId: reply.domainId,
						sharedDevice: true,
						user: reply.deviceName,
						userId: reply.deviceId
					});
					return AH.resolve(reply.customData);
				});
			});

		return AH.notify(Message.getMessage(Constants.messageCodes.registeringDevice), promise);
	}

	/**
	 * @method colonize
	 * Colonizes a registered device on behalf of the specified user.
	 *
	 * @param {String} user
	 * Name of the backend user
	 *
	 * @param {String} password
	 * Password of the user.
	 *
	 * @param {Object} [options]
	 *
	 * @param {Number} [options.maxRetries=-1 (forever)]
	 *
	 * Maximum number of times to retry colonizing while the server is preparing data.
	 *
	 * If this value is exceeded, the returned promise will reject with a {@link Constants.ErrorCode#noDatastore noDatastore} error.
	 *
	 * @param {Number} [options.retryInterval=5000 (5 seconds)]
	 *
	 * Number of milliseconds to wait while the server is preparing data before retrying colonization.
	 *
	 * @param {Promise} [options.cancelPromise]
	 *
	 * Promise that can be used to abort retrying colonization.
	 *
	 * * If it is rejected, the returned promise will reject with the `cancelPromise` error.
	 * * If it is resolved, the returned promise will reject with a {@link Constants.ErrorCode#canceled canceled} error
	 *
	 * @returns {Promise}
	 * Returns a {@link Promise} that resolves when the operation completes.
	 *
	 * @async
	 *
	 * @message {@link Constants.MessageCode#applyingServerChanges ApplyingServerChanges}
	 *
	 * @message {@link Constants.MessageCode#preparingUpload PreparingUpload}
	 *
	 * @message {@link Constants.MessageCode#extractingFile ExtractingFile}
	 *
	 * @message {@link Constants.MessageCode#resettingDatabase ResettingDatabase}
	 *
	 * @message {@link Constants.MessageCode#deployingDatabase DeployingDatabase}
	 *
	 * @message {@link Constants.MessageCode#uploadingFile UploadingFile}
	 *
	 * @message {@link Constants.MessageCode#downloadingFile DownloadingFile}
	 *
	 * @message {@link Constants.MessageCode#downloadingSegment DownloadingSegment}
	 *
	 * @message {@link Constants.MessageCode#checkingForAttachmentDownloads CheckingForAttachmentDownloads}
	 *
	 * @message {@link Constants.MessageCode#checkingForAttachmentUploads CheckingForAttachmentUploads}
	 *
	 * @message {@link Constants.MessageCode#downloadingVaultFiles DownloadingVaultFiles}
	 *
	 * @message {@link Constants.MessageCode#downloadingVaultFile DownloadingVaultFile}
	 *
	 * @message {@link Constants.MessageCode#uploadingVaultFiles UploadingVaultFiles}
	 *
	 * @message {@link Constants.MessageCode#uploadingVaultFile UploadingVaultFile}
	 *
	 * @message {@link Constants.MessageCode#authenticating Authenticating}
	 *
	 * @message {@link Constants.MessageCode#disconnecting Disconnecting}
	 *
	 * @message {@link Constants.MessageCode#requestingFiles RequestingFiles}
	 *
	 * ### Usage:
	 *
	 * 	mdoClient.isDeviceRegistered()
	 * 			? mdoClient.resolve() : mdoClient.registerDevice(serverUrl, domain, password)
	 *		.then(function() {
	 * 			mdoClient.colonize(user, password)
	 * 				.then(function() {
	 * 					var mdoCon = mdoClient.createConnection();
	 * 					mdoCon.login(user, password)
	 * 						.then(...);
	 * 				}, function(error) {
	 * 					alert("Colonize failed: " + error);
	 * 				);
	 *  	});
	 */
	function colonize(user, password, options) {
		var err = getPrerequisitesError();
		if (err) {
			return AH.reject(err);
		}
		if (!isDeviceRegistered()) {
			return AH.reject(new MdoError("The device is not registered", Constants.errorCodes.deviceNotRegistered));
		}
		options = _.extend({
			retryInterval: 5000,
			maxRetries: -1
		}, options);
		
		var domain = MdoDomain.retrieve();
		var retryCount = options.maxRetries;
		// Indicates that colonization has been canceled via the cancelPromise
		var canceled = false;
		var cancelPromise = options.cancelPromise;

		return AH.chainPromise(tryToColonize(), cancelableDeferred());

		function tryToColonize() {
			return changeUser(user, password)
				.then(function() {
					if (domain.domInfo.getNumDatastores() <= 0) {
						return AH.reject(new MdoError("Datastore has not been prepared for installation", Constants.errorCodes.noDatastore));
					}
				}, function(changeUserErr) {
					if (retryCount && !canceled && changeUserErr.mdoCode === Constants.errorCodes.dataRepostInProgress) {
						--retryCount;
						var dfd = cancelableDeferred();

						// Retry after retryInterval (unless canceled)
						setTimeout(function() {
							if (!canceled) {
								AH.chainPromise(tryToColonize(), dfd);
							}
						}, options.retryInterval);

						return AH.notify("Server is preparing data...", dfd.promise);
					}

					domain.logError(changeUserErr);
					return AH.reject(AH.normalizeWebSqlError(changeUserErr));
				});
		}

		// Create a deferred that can be canceled via the cancelPromise
		function cancelableDeferred() {
			// Create deferred that is canceled via cancelPromise
			var dfd = AH.defer();
			if (cancelPromise) {
				AH.when(cancelPromise, function() {
					canceled = true;
					dfd.reject(new MdoError("Colonization was canceled.", Constants.errorCodes.canceled));
				}, function(cancelError) {
					canceled = true;
					dfd.reject(cancelError);
				});
			}

			return dfd;
		}
	}

	// ## client.isInstalled(nameOrID)

	/**
	@method isInstalled
	Tests whether an MDO domain is currently installed.

	@param {String} [nameOrId]
	When specified, the domain name or ID must match this value.

	@returns {Object}
	If the client is associated with an M-Tier domain user the function returns information about the domain.
	Otherwise it returns `false`.
	*/

	function isInstalled(nameOrId) {
		var dom = MdoDomain.retrieve(nameOrId);
		return (dom && dom.domInfo.getNumDatastores()) ? dom.domInfo : false;
	}

	/**
	 * @method install
	 * Installs a domain and data store for the specified user.
	 *
	 * @param {String} serverUrl
	 * URL to the M-Tier DataSync service (usually `/MTierData`)
	 *
	 * @param {String} domainName
	 * Name of the M-Tier Domain
	 *
	 * @param {String} user
	 * Name of the M-Tier User (Device User or Device Account)
	 *
	 * @param {String} password
	 * Password of the M-Tier user.
	 *
	 * @returns {Promise}
	 * Returns a {@link Promise} that resolves when the operation completes.
	 *
	 * @message {@link Constants.MessageCode#applyingServerChanges ApplyingServerChanges}
	 *
	 * @message {@link Constants.MessageCode#preparingUpload PreparingUpload}
	 *
	 * @message {@link Constants.MessageCode#extractingFile ExtractingFile}
	 *
	 * @message {@link Constants.MessageCode#resettingDatabase ResettingDatabase}
	 *
	 * @message {@link Constants.MessageCode#deployingDatabase DeployingDatabase}
	 *
	 * @message {@link Constants.MessageCode#uploadingFile UploadingFile}
	 *
	 * @message {@link Constants.MessageCode#downloadingFile DownloadingFile}
	 *
	 * @message {@link Constants.MessageCode#downloadingSegment DownloadingSegment}
	 *
	 * @message {@link Constants.MessageCode#checkingForAttachmentDownloads CheckingForAttachmentDownloads}
	 *
	 * @message {@link Constants.MessageCode#checkingForAttachmentUploads CheckingForAttachmentUploads}
	 *
	 * @message {@link Constants.MessageCode#downloadingVaultFiles DownloadingVaultFiles}
	 *
	 * @message {@link Constants.MessageCode#downloadingVaultFile DownloadingVaultFile}
	 *
	 * @message {@link Constants.MessageCode#uploadingVaultFiles UploadingVaultFiles}
	 *
	 * @message {@link Constants.MessageCode#uploadingVaultFile UploadingVaultFile}
	 *
	 * @message {@link Constants.MessageCode#authenticating Authenticating}
	 *
	 * @message {@link Constants.MessageCode#disconnecting Disconnecting}
	 *
	 * @message {@link Constants.MessageCode#requestingFiles RequestingFiles}
	 *
	 * @async
	 */
	function install(serverUrl, domainName, user, password) {

		return normalizeConnectionInfo(serverUrl, domainName, user, password)
			.then(function(conInfo) {
				serverUrl = conInfo.serverUrl;
				var credentials = conInfo.credentials;
				var server = new Server(serverUrl, function () {
					return credentials;
				});

				var domain;
				return server.session(function (srvr, info) {
					return AH.resolve(MdoDomain.create(_.extend({ serverUrl: serverUrl }, info, credentials)));
				}).then(function (dom) {
					domain = dom;
					return internal.sync(domain, { password: password });
				})
					.then(function () {
						if (domain.domInfo.getNumDatastores() > 0) {
							return {
								domainName: domainName,
								userName: user,
								userId: domain.domInfo.userId(),
								domainId: domain.domInfo.id(),
								serverUrl: serverUrl
							};
						}
						return rollback(new MdoError("Datastore has not been prepared for installation", Constants.errorCodes.noDatastore));
					}, rollback);

				function rollback(err) {
					(domain || logger).logError(err);

					// return the install error even if the uninstall fails

					return exports.uninstall().then(reject, function (error) {
						// log the uninstall error since we're suppressing it.
						if (error && error.message) {
							error.message = "MDOUninstall: " + error.message;
						}
						logger.logError(error);
						return reject();
					});

					function reject() {
						return AH.reject(AH.normalizeWebSqlError(err));
					}
				}

			});
	}

	/**
	 * @method normalizeConnectionInfo
	 * @private
	 *
	 * Validates and normalizes connection parameters.
	 *
	 * @param serverUrl
	 * @param domainName
	 * @param user
	 * @param password
	 *
	 * @returns {Object}
	 *
	 * @return {String} return.serverUrl
	 * Normalized serverUrl (with trailing '/')
	 *
	 * @return {Object} return.credentials
	 * Credentials containing `domain`, `user` and `password`.
	 */
	function normalizeConnectionInfo(serverUrl, domainName, user, password) {
		if (!AH.isDefined(user)) {
			return AH.reject(new MdoError("Invalid Username: " + (user === null ? "null" : "undefined"), Constants.errorCodes.invalidCredentials));
		}

		if (!AH.isDefined(domainName) || domainName === "") {
			return AH.reject(new MdoError("Missing domain name", Constants.errorCodes.missingDomainName));
		}

		var err = getPrerequisitesError();
		if (err) {
			return AH.reject(err);
		}

		// Add trailing '/', if necessary
		if (serverUrl && serverUrl.charAt(serverUrl.length - 1) !== "/") {
			serverUrl += "/";
		}

		return AH.resolve({
			serverUrl: serverUrl,
			credentials: {
				domain: domainName,
				user: user,
				password: password
			}
		});
	}

	// ## client.changeUser(user, password)

	/**
	@method changeUser
	Changes the user associated with this shared device.

	@param {String} user
	Name of the backend user

	@param {String} password
	Password of the user.

	@returns {Promise}
	Returns a {@link Promise} that resolves when the operation completes.

	@async

	@message {@link Constants.MessageCode#applyingServerChanges ApplyingServerChanges}

	@message {@link Constants.MessageCode#preparingUpload PreparingUpload}

	@message {@link Constants.MessageCode#extractingFile ExtractingFile}

	@message {@link Constants.MessageCode#resettingDatabase ResettingDatabase}

	@message {@link Constants.MessageCode#deployingDatabase DeployingDatabase}

	@message {@link Constants.MessageCode#uploadingFile UploadingFile}

	@message {@link Constants.MessageCode#downloadingFile DownloadingFile}

	@message {@link Constants.MessageCode#downloadingSegment DownloadingSegment}

	@message {@link Constants.MessageCode#checkingForAttachmentDownloads CheckingForAttachmentDownloads}

	@message {@link Constants.MessageCode#checkingForAttachmentUploads CheckingForAttachmentUploads}

	@message {@link Constants.MessageCode#downloadingVaultFiles DownloadingVaultFiles}

	@message {@link Constants.MessageCode#downloadingVaultFile DownloadingVaultFile}

	@message {@link Constants.MessageCode#uploadingVaultFiles UploadingVaultFiles}

	@message {@link Constants.MessageCode#uploadingVaultFile UploadingVaultFile}

	@message {@link Constants.MessageCode#authenticating Authenticating}

	@message {@link Constants.MessageCode#disconnecting Disconnecting}

	@message {@link Constants.MessageCode#requestingFiles RequestingFiles}

	### Usage:

		mdoClient.changeUser(user, password)
			.then(function() {
				var mdoCon = mdoClient.createConnection();
				mdoCon.login(user, password)
					.then(...);
			}, function(error) {
				alert("Change User failed: " + error);
			);
	*/
	function changeUser(user, password) {

		var err = getPrerequisitesError();
		if (err) {
			return AH.reject(err);
		}

		var domain = MdoDomain.retrieve();
		if (!domain) {
			return AH.reject(new MdoError("Client not installed", Constants.errorCodes.clientNotInstalled));
		}

		if (!domain.domInfo.device()) {
			return AH.reject(new MdoError("Change user not supported", Constants.errorCodes.notSupported));
		}

		return internal.sync(domain, {
			user: user,
			password: password,
			deviceSharing: Constants.deviceSharing.changeUser
		}).then(function () {
			domain.domInfo.saveCredentials(user, password);
		}).then(null, function (syncErr) {
			return AH.reject(AH.normalizeWebSqlError(syncErr));
		});
	}


	/**
	 *
	 * @method resetUser
	 * Resets the user associated with this shared device.  A {@link #changeUser} operation will be required before
	 * another user can open the conenction.
	 *
	 * @returns {Promise}
	 * Returns a {@link Promise} that resolves when the operation completes.
	 *
	 * @async
	 *
	 * ### Usage:
	 *
	 *     mdoClient.resetUser(user, password)
	 *         .then(function() {
	 *             alert("User reset!");
	 *  	   }, function(error) {
	 *  	       alert("Reset User failed: " + error);
	 *  	   );
	 */
	function resetUser() {

		var domain = MdoDomain.retrieve();
		if (!domain) {
			return AH.reject(new MdoError("Client not installed", Constants.errorCodes.clientNotInstalled));
		}

		if (!domain.domInfo.device()) {
			return AH.reject(new MdoError("Reset user not supported", Constants.errorCodes.notSupported));
		}

		return AH.resolve(domain.domInfo.clearCredentials());
	}

	// ## client.uninstall()

	/**
	@method uninstall
	Resets the client to the uninstalled state.

	@returns {Promise}
	Returns a {@link Promise} that resolves when operation completes.

	@async
	*/
	function uninstall() {
		logger.log("### Uninstall Started ###", { category: "INFO" });
		var dom = MdoDomain.retrieve();

		if (dom) {
			return dom.destroy().then(function() {
				logger.log("### Uninstall complete ###", { category: "INFO" });
			});
		}

		logger.log("Nothing to do", { category: "INFO" });
		logger.log("### Uninstall complete ###", { category: "INFO" });
		return AH.resolve();
	}
	// ## client.createConnection(datastore)

	/**
	@method createConnection

	Creates an MDO.Connection to the specified datastore.

	@param {String} [datastore]

	Name of the datastore.  When not specified, the default datastore is used.

	@returns {MDO.Connection}

	@throws {Error}
	If MDO.Client is not installed or if the specified `datastore` doesn't exist.
	*/
	function createConnection(datastore) {

		var err = getPrerequisitesError();
		if (err) {
			throw err;
		}

		var dom = MdoDomain.retrieve();
		if (!dom) {
			throw new MdoError("Client not installed", Constants.errorCodes.clientNotInstalled);
		}

		var ds;

		if (!datastore) {
			ds = dom.getDefaultDatastore();
		} else {
			ds = dom.getDatastoreByName(datastore);
			if (!ds) {
				throw new MdoError("Datastore '" + datastore + "' does not exist", Constants.errorCodes.noDatastore);
			}
		}

		return new MdoConnection(dom, ds, exports);
	}

	var settings = {};

	/**
	 * @method config
	 *
	 * Set configuration settings for MDO client.
	 *
	 * @param {Object} options
	 *
	 * @param {String} [options.traceDb="" - no tracing]
	 *
	 * Configures how to log database operations to the console.  Valid setting are:
	 *
	 *  * `"sql`" - log just the SQL statement
	 *  * `"sql-params"` - log SQL statement and truncated (...) parameters
	 *  * `"sql-params-full"` - log SQL statement and full parameters
	 *
	 * @param {Boolean} [options.collectStats=false]
	 *
	 * Configures whether to collect execution statistics
	 *
	 * @param {Number} [options.syncAuthenticationTimeout=30000]
	 *
	 * Configures the timeout (ms) for sync authentication
	 *
	 * @param {Number} [options.syncRequestTimeout=120000]
	 *
	 * Configures the timeout (ms) for sync operations
	 *
	 * @param {Number} [options.syncAttachmentTimeout=120000]
	 *
	 * Configures the timeout (ms) for attachment uploads and downloads
	 *
	 * @param {Number} [options.syncDisconnectTimeout=5000]
	 *
	 * Configures the timeout (ms) for disconnecting from server
	 *
	 * @return {Object}
	 *
	 * Current MDO client configuration
	 *
	 * @return {Boolean} return.collectStats
	 *
	 * Current {@link MDO.Stats#enabled} setting.
	 *
	 * @return {String} return.traceDb
	 *
	 * Current SQL logging setting.
	 *
	 * @return {Number} return.syncAuthenticationTimeout
	 *
	 * Current authentication sync timeout setting.
	 *
	 * @return {Number} return.syncRequestTimeout
	 *
	 * Current sync timeout setting.
	 *
	 * @return {Number} return.syncAttachmentTimeout
	 *
	 * Current attachment upload and download timeout setting.
	 *
	 * @return {Number} return.syncDisconnectTimeout
	 *
	 * Current disconnect sync timeout setting.
	 *
	 */
	function config(options) {
		if (_.isObject(options)) {

			if (!_.isUndefined(options.traceDb)) {
				AH.websql.config({
					traceDb: options.traceDb
				});
			}

			if (!_.isUndefined(options.collectStats)) {
				MdoStats.enabled = Boolean(options.collectStats);
			}

			if (!_.isUndefined(options.syncDisconnectTimeout)) {
				HttpConfig.disconnectTimeout = options.syncDisconnectTimeout;
			}

			if (!_.isUndefined(options.syncAuthenticationTimeout)) {
				HttpConfig.authenticationTimeout = options.syncAuthenticationTimeout;
			}

			if (!_.isUndefined(options.syncRequestTimeout)) {
				HttpConfig.requestTimeout = options.syncRequestTimeout;
			}

			if (!_.isUndefined(options.syncAttachmentTimeout)) {
				HttpConfig.attachmentTimeout = options.syncAttachmentTimeout;
			}

		}
		return {
			traceDb: AH.websql.config().traceDb,
			collectStats: MdoStats.enabled,
			syncDisconnectTimeout: HttpConfig.disconnectTimeout,
			syncAuthenticationTimeout: HttpConfig.authenticationTimeout,
			syncRequestTimeout: HttpConfig.requestTimeout,
			syncAttachmentTimeout: HttpConfig.attachmentTimeout
		};
	}

	function getDeviceUuid() {
		// Use cordova-plugin-device, if present
		// https://github.com/apache/cordova-plugin-device#deviceuuid
		if (window.device && window.device.uuid) {
			return window.device.uuid;
		}

		// Simulate a deviceUid and persist it in localStorage
		var deviceUid = localStorage["@deviceUuid"];
		if (!deviceUid) {
			localStorage["@deviceUuid"] = deviceUid = uuid.uuid();
		}
		return deviceUid;
	}

	function getDevicePlatform() {
		// Use cordova-plugin-device, if present
		// https://github.com/apache/cordova-plugin-device#deviceplatform
		switch (window.device && window.device.platform) {
			case "Android":
				return Constants.devicePlatforms.easAndroid;
			case "iOS":
				return Constants.devicePlatforms.easIos;
			case "Win32NT":
				return Constants.devicePlatforms.easWindows8;
			default:
				return Constants.devicePlatforms.browser;
		}
	}

	function getDeviceModel() {
		// Use cordova-plugin-device, if present
		// https://github.com/apache/cordova-plugin-device#devicemodel
		if (window.device && window.device.model) {
			return window.device.model;
		}
		return navigator.userAgent;
	}

	internal = {
		sync: function (domain, options) {
			return new MdoSynchronizer(domain).sync(options);
		}
	};

	exports = {
		config: config,
		isDeviceRegistered: isDeviceRegistered,
		registerDevice: registerDevice,
		colonize: colonize,
		isInstalled: isInstalled,
		install: install,
		uninstall: uninstall,
		changeUser: changeUser,
		resetUser: resetUser,
		createConnection: createConnection,
		executeServerRpc: executeServerRpc,

		/**
		@property {String} [version=current version]
		@readonly

		Current version of MDO.js
		*/
		version: "6.5.0.104",

		/**
		 * @property {MDO.Stats} stats
		 * @readonly
		 *
		 * MDO stats
		 */
		stats: MdoStats,


		/**
		* @property {Logging.Logger} logger
		*
		* MDO Logging
		*/
		logger: logger,


		/**
		 * @property {Constants} constants
		 *
		 * MDO Constants
		 */
		constants: Constants,

		/**
		 * @property {Messages.Message} Message
		 *
		 * Message constructor.
		 */
		Message: Message,

		errorCodes: _.extend({}, Constants.errorCodes),

		connectionStates: _.extend({}, Constants.connectionStates),

		connectionEvents: _.extend({}, Constants.connectionEvents),

		/**
		@method defer

		Creates a {@link Deferred} object.

		@returns {Deferred}
		*/

		defer: AH.defer,

		/**
		@method when

		Observes a promise or immediate value.

		If `promiseOrValue` is a value, `onFulfilled` callback is called with that value, and returns a {@link Promise} for the result.

		If `promiseOrValue` is a {@link Promise}, arranges for callbacks to be called when the {@link Promise} resolves.

		onFulfilled to be called with the value after promiseOrValue is fulfilled, or
		onRejected to be called with the rejection reason after promiseOrValue is rejected.
		onProgress to be called with any progress updates issued by promiseOrValue.

		@param valueOrPromise
		Observed value

		@param {Function} onFulfilled
		Called with the resolved value after `promiseOrValue` is fulfilled

		@param {Function} onRejected
		Called with the rejection reason after `promiseOrValue` is rejected

		@param {Function} onProgress
		Called with any progress updates issued by `promiseOrValue`

		@returns {Promise}

		@async
		*/
		when: AH.when,

		/**
		@method whenAll

		Observe an array of {@link Promise} and/or immediate values.

		@param {Array} promissesOrValues
		Observed values

		@returns {Promise}
		The returned {Promise} resolves with an array of values resolved from `promissesOrValues`

		@async
		*/
		whenAll: AH.whenAll,

		/**
		@method resolve

		Returns a resolved {@link Promise}.

		@param [value]
		Value to resolve with.

		@returns {Promise}
		A {@link Promise} that's resolved with the `value`.

		@async
		*/
		resolve: AH.resolve,

		/**
		@method reject

		Returns a rejected {@link Promise}.

		@param {Error} error
		Value to reject with.

		@returns {Promise}
		A {@link Promise} that's rejected with the `error`.

		@async
		*/
		reject: AH.reject,

		/**
		 * @method notify
		 *
		 * Returns a {@link Promise} that will notify its subscribers with `message` *before* any
		 * progress notifications from the chained `promise`.
		 * The returned promise will resolve or rejects with the results of the chained `promise`.
		 *
		 * @param {string | Messages.Message} message notification that should be prepended to the returned promise
		 * @param {Promise} promise existing promise to chain the `message` notification onto
		 *
		 * @async
		 *
		 * ### Usage Example
		 *
		 * 	function myMethod() {
		 * 		var promise = step1();
		 * 		promise = promise.then(step2);
		 * 		...
		 * 		return mdoClient.notify("Performing an operation...", promise);
		 * 	}
		 **/
		notify: AH.notify,

		/**
		 * Chains the rejection/resolution/notification methods of 'promise' to 'dfd'.
		 *
		 * @param {Promise} promise - The promise to chain onto
		 * @param {Deferred} dfd - The deferred to be chained
		 *
		 **/
		chainPromise: AH.chainPromise,

		// Undocumented exports:

		// underscore.js and Backbone.js, used by MWC
		_: _, Backbone: Backbone,

		// _internals used in unit tests
		_internal: internal
	};

	Object.defineProperties(exports, {
		settings: {
			get: function () {
				return settings;
			}
		},
		/**
		 * @property {String} deviceUuid
		 */
		deviceUuid: {
			get: getDeviceUuid
		},
		/**
		 * @property {Constants.DevicePlatforms} devicePlatform
		 * The environment in which MDO.js is being used.
		 */
		devicePlatform: {
			get: getDevicePlatform
		},
		/**
		 * @property {String} deviceModel
		 */
		deviceModel: {
			get: getDeviceModel
		}
	});

	Object.defineProperties(internal, {
		getPrerequisitesError: {
			get: function () {
				return getPrerequisitesError;
			},
			set: function(value) {
				getPrerequisitesError = value;
			}
		}
	});

	return exports;
});

define('mdo',["MDO/Client"], function(client) {
	"use strict";
	return client;
});

	return require("mdo");
}));
