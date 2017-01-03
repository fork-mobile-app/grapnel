/****
 * Grapnel
 * https://github.com/baseprime/grapnel
 *
 * @author Greg Sabia Tucker <greg@narrowlabs.com>
 * @link http://basepri.me
 *
 * Released under MIT License. See LICENSE.txt or http://opensource.org/licenses/MIT
*/

import * as events from 'events';
import { deprecate } from 'util';

export const root = window || { history: {}, location: {} };

export default class Grapnel extends events.EventEmitter {
    state: any;
    version: string;
    _maxListeners: number = Infinity;
    options: any = {};
    defaults: any = {
        env: 'client',
        pushState: false
    }
    
    constructor(opts:any) {
        super();
        this.options = Grapnel.assign({}, this.defaults, opts);
        
        if ('object' === typeof window && 'function' === typeof window.addEventListener) {
            window.addEventListener('hashchange', () => {
                this.emit('hashchange');
            });

            window.addEventListener('popstate', (e) => {
                // Make sure popstate doesn't run on init -- this is a common issue with Safari and old versions of Chrome
                if (this.state && this.state.previousState === null) return false;

                this.emit('navigate');
            });
        }
    }

    static regexRoute(path: any, keys: any[], sensitive: boolean, strict: boolean) {
        if (path instanceof RegExp) return path;
        if (path instanceof Array) path = '(' + path.join('|') + ')';
        // Build route RegExp
        let newPath = path.concat(strict ? '' : '/?')
            .replace(/\/\(/g, '(?:/')
            .replace(/\+/g, '__plus__')
            .replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?/g, function(_: any, slash: any, format: any, key: any, capture: any, optional: any) {
                keys.push({
                    name: key,
                    optional: !!optional
                });
                slash = slash || '';

                return '' + (optional ? '' : slash) + '(?:' + (optional ? slash : '') + (format || '') + (capture || (format && '([^/.]+?)' || '([^/]+?)')) + ')' + (optional || '');
            })
            .replace(/([\/.])/g, '\\$1')
            .replace(/__plus__/g, '(.+)')
            .replace(/\*/g, '(.*)');

        return new RegExp('^' + newPath + '$', sensitive ? '' : 'i');
    }

    static listen() {
        var opts: any;
        var routes: any;
        if (arguments[0] && arguments[1]) {
            opts = arguments[0];
            routes = arguments[1];
        } else {
            routes = arguments[0];
        }
        // Return a new Grapnel instance
        return (function() {
            // TODO: Accept multi-level routes
            for (var key in routes) {
                this.add.call(this, key, routes[key]);
            }

            return this;
        }).call(new Grapnel(opts || {}));
    }

    // Polyfill Object.assign
    static assign(target: any, varArgs: any) {
        if ('function' === typeof Object.assign) return Object.assign.apply(this, arguments);
        if (target == null) { // TypeError if undefined or null
            throw new TypeError('Cannot convert undefined or null to object');
        }

        var to = Object(target);

        for (var index = 1; index < arguments.length; index++) {
            var nextSource = arguments[index];

            if (nextSource != null) { // Skip over if undefined or null
                for (var nextKey in nextSource) {
                    // Avoid bugs when hasOwnProperty is shadowed
                    if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                        to[nextKey] = nextSource[nextKey];
                    }
                }
            }
        }

        return to;
    }

    add(route: string & RegExp) {
        var self = this,
            middleware: Function[] = Array.prototype.slice.call(arguments, 1, -1),
            handler: Function = Array.prototype.slice.call(arguments, -1)[0],
            request = new Request(route);

        var invoke = function RouteHandler() {
            // Build request parameters
            var req = request.parse(self.path());
            // Check if matches are found
            if (req.match) {
                // Match found
                var extra = {
                    route: route,
                    params: req.params,
                    req: req,
                    regex: req.match
                };
                // Create call stack -- add middleware first, then handler
                var stack = new CallStack(self, extra).enqueue(middleware.concat(handler));
                // emit main event
                self.emit('match', stack, req);
                // Continue?
                if (!stack.runCallback) return self;
                // Previous state becomes current state
                stack.previousState = self.state;
                // Save new state
                self.state = stack;
                // Prevent this handler from being called if parent handler in stack has instructed not to propagate any more events
                if (stack.parent() && stack.parent().propagateEvent === false) {
                    stack.propagateEvent = false;
                    return self;
                }
                // Call handler
                stack.callback();
            }
            // Returns self
            return self;
        };
        // Event name
        var eventName = (!self.options.pushState && self.options.env !== 'server') ? 'hashchange' : 'navigate';
        // Invoke when route is defined, and once again when app navigates
        return invoke().on(eventName, invoke);
    }

    get() {
        return this.add.apply(this, arguments);
    }

    trigger() {
        return this.emit.apply(this, arguments);
    }

    bind() {
        return this.on.apply(this, arguments);
    }

    context(context: string & RegExp) {
        var self = this,
            middleware = Array.prototype.slice.call(arguments, 1);

        return function() {
            var value = arguments[0],
                submiddleware = (arguments.length > 2) ? Array.prototype.slice.call(arguments, 1, -1) : [],
                handler = Array.prototype.slice.call(arguments, -1)[0],
                prefix = (context.slice(-1) !== '/' && value !== '/' && value !== '') ? context + '/' : context,
                path = (value.substr(0, 1) !== '/') ? value : value.substr(1),
                pattern = prefix + path;

            return self.add.apply(self, [pattern].concat(middleware).concat(submiddleware).concat([handler]));
        }
    }

    navigate(path: string) {
        return this.path(path).emit('navigate');
    }

    path(pathname?: string) {
        var self = this,
            frag;

        if ('string' === typeof pathname) {
            // Set path
            if (self.options.pushState) {
                frag = (self.options.root) ? (self.options.root + pathname) : pathname;
                root.history.pushState({}, null, frag);
            } else if (root.location) {
                root.location.hash = (self.options.hashBang ? '!' : '') + pathname;
            } else {
                root._pathname = pathname || '';
            }

            return this;
        } else if ('undefined' === typeof pathname) {
            // Get path
            if (self.options.pushState) {
                frag = root.location.pathname.replace(self.options.root, '');
            } else if (!self.options.pushState && root.location) {
                frag = (root.location.hash) ? root.location.hash.split((self.options.hashBang ? '#!' : '#'))[1] : '';
            } else {
                frag = root._pathname || '';
            }

            return frag;
        } else if (pathname === false) {
            // Clear path
            if (self.options.pushState) {
                root.history.pushState({}, null, self.options.root || '/');
            } else if (root.location) {
                root.location.hash = (self.options.hashBang) ? '!' : '';
            }

            return self;
        }
    }
}

export class CallStack {
    stack: any[];
    router: Grapnel;
    runCallback: boolean = true;
    callbackRan: boolean = true;
    propagateEvent: boolean = true;
    value: string;
    previousState: any;
    timeStamp: Number;

    static global: any[] = [];

    constructor(router: Grapnel, extendObj: any) {
        this.stack = CallStack.global.slice(0);
        this.router = router;
        this.runCallback = true;
        this.callbackRan = false;
        this.propagateEvent = true;
        this.value = router.path();

        Grapnel.assign(this, extendObj);

        return this;
    }

    preventDefault() {
        this.runCallback = false;
    }

    stopPropagation() {
        this.propagateEvent = false;
    }

    parent() {
        var hasParentEvents = !!(this.previousState && this.previousState.value && this.previousState.value == this.value);
        return (hasParentEvents) ? this.previousState : false;
    }

    callback() {
        this.callbackRan = true;
        this.timeStamp = Date.now();
        this.next();
    }

    enqueue(handler: any, atIndex?: number) {
        var handlers = (!Array.isArray(handler)) ? [handler] : ((atIndex < handler.length) ? handler.reverse() : handler);

        while (handlers.length) {
            this.stack.splice(atIndex || this.stack.length + 1, 0, handlers.shift());
        }

        return this;
    }

    next() {
        var self = this;

        return this.stack.shift().call(this.router, this.req, this, function next() {
            self.next.call(self);
        });
    }
}

export class Request {
    route: string;
    keys: string[];
    regex: RegExp;

    constructor(route: string) {
        this.route = route;
        this.keys = [];
        this.regex = Grapnel.regexRoute(route, this.keys);
    }

    parse(path: string) {
        var match = path.match(this.regex),
            self = this;

        var req = {
            params: {},
            keys: this.keys,
            matches: (match || []).slice(1),
            match: match
        };
        // Build parameters
        req.matches.forEach(function(value, i) {
            var key = (self.keys[i] && self.keys[i].name) ? self.keys[i].name : i;
            // Parameter key will be its key or the iteration index. This is useful if a wildcard (*) is matched
            req.params[key] = (value) ? decodeURIComponent(value) : undefined;
        });

        return req;
    }
}

if('object' === typeof window) {
    window.Grapnel = Grapnel;
}