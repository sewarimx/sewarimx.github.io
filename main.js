(function () {

	function noop() {}

	function assign(tar, src) {
		for (const k in src) tar[k] = src[k];
		return tar;
	}

	function is_promise(value) {
		return value && typeof value.then === 'function';
	}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function subscribe(component, store, callback) {
		const unsub = store.subscribe(callback);

		component.$$.on_destroy.push(unsub.unsubscribe
			? () => unsub.unsubscribe()
			: unsub);
	}

	function create_slot(definition, ctx, fn) {
		if (definition) {
			const slot_ctx = get_slot_context(definition, ctx, fn);
			return definition[0](slot_ctx);
		}
	}

	function get_slot_context(definition, ctx, fn) {
		return definition[1]
			? assign({}, assign(ctx.$$scope.ctx, definition[1](fn ? fn(ctx) : {})))
			: ctx.$$scope.ctx;
	}

	function get_slot_changes(definition, ctx, changed, fn) {
		return definition[1]
			? assign({}, assign(ctx.$$scope.changed || {}, definition[1](fn ? fn(changed) : {})))
			: ctx.$$scope.changed || {};
	}

	function exclude_internal_props(props) {
		const result = {};
		for (const k in props) if (k[0] !== '$') result[k] = props[k];
		return result;
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor || null);
	}

	function detach(node) {
		node.parentNode.removeChild(node);
	}

	function element(name) {
		return document.createElement(name);
	}

	function text(data) {
		return document.createTextNode(data);
	}

	function space() {
		return text(' ');
	}

	function empty() {
		return text('');
	}

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function prevent_default(fn) {
		return function(event) {
			event.preventDefault();
			return fn.call(this, event);
		};
	}

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function set_attributes(node, attributes) {
		for (const key in attributes) {
			if (key === 'style') {
				node.style.cssText = attributes[key];
			} else if (key in node) {
				node[key] = attributes[key];
			} else {
				attr(node, key, attributes[key]);
			}
		}
	}

	function children(element) {
		return Array.from(element.childNodes);
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	function custom_event(type, detail) {
		const e = document.createEvent('CustomEvent');
		e.initCustomEvent(type, false, false, detail);
		return e;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	function onDestroy(fn) {
		get_current_component().$$.on_destroy.push(fn);
	}

	function createEventDispatcher() {
		const component = current_component;

		return (type, detail) => {
			const callbacks = component.$$.callbacks[type];

			if (callbacks) {
				// TODO are there situations where events could be dispatched
				// in a server (non-DOM) environment?
				const event = custom_event(type, detail);
				callbacks.slice().forEach(fn => {
					fn.call(component, event);
				});
			}
		};
	}

	function setContext(key, context) {
		get_current_component().$$.context.set(key, context);
	}

	function getContext(key) {
		return get_current_component().$$.context.get(key);
	}

	const dirty_components = [];

	const resolved_promise = Promise.resolve();
	let update_scheduled = false;
	const binding_callbacks = [];
	const render_callbacks = [];
	const flush_callbacks = [];

	function schedule_update() {
		if (!update_scheduled) {
			update_scheduled = true;
			resolved_promise.then(flush);
		}
	}

	function add_binding_callback(fn) {
		binding_callbacks.push(fn);
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}

		update_scheduled = false;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	let outros;

	function group_outros() {
		outros = {
			remaining: 0,
			callbacks: []
		};
	}

	function check_outros() {
		if (!outros.remaining) {
			run_all(outros.callbacks);
		}
	}

	function on_outro(callback) {
		outros.callbacks.push(callback);
	}

	function handle_promise(promise, info) {
		const token = info.token = {};

		function update(type, index, key, value) {
			if (info.token !== token) return;

			info.resolved = key && { [key]: value };

			const child_ctx = assign(assign({}, info.ctx), info.resolved);
			const block = type && (info.current = type)(child_ctx);

			if (info.block) {
				if (info.blocks) {
					info.blocks.forEach((block, i) => {
						if (i !== index && block) {
							group_outros();
							on_outro(() => {
								block.d(1);
								info.blocks[i] = null;
							});
							block.o(1);
							check_outros();
						}
					});
				} else {
					info.block.d(1);
				}

				block.c();
				if (block.i) block.i(1);
				block.m(info.mount(), info.anchor);

				flush();
			}

			info.block = block;
			if (info.blocks) info.blocks[index] = block;
		}

		if (is_promise(promise)) {
			promise.then(value => {
				update(info.then, 1, info.value, value);
			}, error => {
				update(info.catch, 2, info.error, error);
			});

			// if we previously had a then/catch block, destroy it
			if (info.current !== info.pending) {
				update(info.pending, 0);
				return true;
			}
		} else {
			if (info.current !== info.then) {
				update(info.then, 1, info.value, promise);
				return true;
			}

			info.resolved = { [info.value]: promise };
		}
	}

	function get_spread_update(levels, updates) {
		const update = {};

		const to_null_out = {};
		const accounted_for = { $$scope: 1 };

		let i = levels.length;
		while (i--) {
			const o = levels[i];
			const n = updates[i];

			if (n) {
				for (const key in o) {
					if (!(key in n)) to_null_out[key] = 1;
				}

				for (const key in n) {
					if (!accounted_for[key]) {
						update[key] = n[key];
						accounted_for[key] = 1;
					}
				}

				levels[i] = n;
			} else {
				for (const key in o) {
					accounted_for[key] = 1;
				}
			}
		}

		for (const key in to_null_out) {
			if (!(key in update)) update[key] = undefined;
		}

		return update;
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detaching) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detaching);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = blank_object();
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			props: prop_names,
			update: noop,
			not_equal: not_equal$$1,
			bound: blank_object(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blank_object(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
					if ($$.bound[key]) $$.bound[key](value);
					if (ready) make_dirty(component, key);
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	function writable(value, start = noop) {
		let stop;
		const subscribers = [];

		function set(new_value) {
			if (safe_not_equal(value, new_value)) {
				value = new_value;
				if (!stop) return; // not ready
				subscribers.forEach(s => s[1]());
				subscribers.forEach(s => s[0](value));
			}
		}

		function update(fn) {
			set(fn(value));
		}

		function subscribe(run, invalidate = noop) {
			const subscriber = [run, invalidate];
			subscribers.push(subscriber);
			if (subscribers.length === 1) stop = start(set) || noop;
			run(value);

			return () => {
				const index = subscribers.indexOf(subscriber);
				if (index !== -1) subscribers.splice(index, 1);
				if (subscribers.length === 0) stop();
			};
		}

		return { set, update, subscribe };
	}

	var defaultExport = /*@__PURE__*/(function (Error) {
	  function defaultExport(route, path) {
	    var message = "Unreachable '" + route + "', segment '" + path + "' is not defined";
	    Error.call(this, message);
	    this.message = message;
	  }

	  if ( Error ) defaultExport.__proto__ = Error;
	  defaultExport.prototype = Object.create( Error && Error.prototype );
	  defaultExport.prototype.constructor = defaultExport;

	  return defaultExport;
	}(Error));

	function buildMatcher(path, parent) {
	  var regex;

	  var _isSplat;

	  var _priority = -100;

	  var keys = [];
	  regex = path.replace(/[-$.]/g, '\\$&').replace(/\(/g, '(?:').replace(/\)/g, ')?').replace(/([:*]\w+)(?:<([^<>]+?)>)?/g, function (_, key, expr) {
	    keys.push(key.substr(1));

	    if (key.charAt() === ':') {
	      _priority += 100;
	      return ("((?!#)" + (expr || '[^#/]+?') + ")");
	    }

	    _isSplat = true;
	    _priority += 500;
	    return ("((?!#)" + (expr || '[^#]+?') + ")");
	  });

	  try {
	    regex = new RegExp(("^" + regex + "$"));
	  } catch (e) {
	    throw new TypeError(("Invalid route expression, given '" + parent + "'"));
	  }

	  var _hashed = path.includes('#') ? 0.5 : 1;

	  var _depth = path.length * _priority * _hashed;

	  return {
	    keys: keys,
	    regex: regex,
	    _depth: _depth,
	    _isSplat: _isSplat
	  };
	}
	var PathMatcher = function PathMatcher(path, parent) {
	  var ref = buildMatcher(path, parent);
	  var keys = ref.keys;
	  var regex = ref.regex;
	  var _depth = ref._depth;
	  var _isSplat = ref._isSplat;
	  return {
	    _isSplat: _isSplat,
	    _depth: _depth,
	    match: function (value) {
	      var matches = value.match(regex);

	      if (matches) {
	        return keys.reduce(function (prev, cur, i) {
	          prev[cur] = typeof matches[i + 1] === 'string' ? decodeURIComponent(matches[i + 1]) : null;
	          return prev;
	        }, {});
	      }
	    }
	  };
	};

	PathMatcher.push = function push (key, prev, leaf, parent) {
	  var root = prev[key] || (prev[key] = {});

	  if (!root.pattern) {
	    root.pattern = new PathMatcher(key, parent);
	    root.route = (leaf || '').replace(/\/$/, '') || '/';
	  }

	  prev.keys = prev.keys || [];

	  if (!prev.keys.includes(key)) {
	    prev.keys.push(key);
	    PathMatcher.sort(prev);
	  }

	  return root;
	};

	PathMatcher.sort = function sort (root) {
	  root.keys.sort(function (a, b) {
	    return root[a].pattern._depth - root[b].pattern._depth;
	  });
	};

	function merge(path, parent) {
	  return ("" + (parent && parent !== '/' ? parent : '') + (path || ''));
	}
	function walk(path, cb) {
	  var matches = path.match(/<[^<>]*\/[^<>]*>/);

	  if (matches) {
	    throw new TypeError(("RegExp cannot contain slashes, given '" + matches + "'"));
	  }

	  var parts = path.split(/(?=\/|#)/);
	  var root = [];

	  if (parts[0] !== '/') {
	    parts.unshift('/');
	  }

	  parts.some(function (x, i) {
	    var parent = root.slice(1).concat(x).join('') || null;
	    var segment = parts.slice(i + 1).join('') || null;
	    var retval = cb(x, parent, segment ? ("" + (x !== '/' ? x : '') + segment) : null);
	    root.push(x);
	    return retval;
	  });
	}
	function reduce(key, root, _seen) {
	  var params = {};
	  var out = [];
	  var splat;
	  walk(key, function (x, leaf, extra) {
	    var found;

	    if (!root.keys) {
	      throw new defaultExport(key, x);
	    }

	    root.keys.some(function (k) {
	      if (_seen.includes(k)) { return false; }
	      var ref = root[k].pattern;
	      var match = ref.match;
	      var _isSplat = ref._isSplat;
	      var matches = match(_isSplat ? extra || x : x);

	      if (matches) {
	        Object.assign(params, matches);

	        if (root[k].route) {
	          var routeInfo = Object.assign({}, root[k].info); // properly handle exact-routes!

	          var hasMatch = false;

	          if (routeInfo.exact) {
	            hasMatch = extra === null;
	          } else {
	            hasMatch = !(x && leaf === null) || x === leaf || _isSplat || !extra;
	          }

	          routeInfo.matches = hasMatch;
	          routeInfo.params = Object.assign({}, params);
	          routeInfo.route = root[k].route;
	          routeInfo.path = _isSplat && extra || leaf || x;
	          out.push(routeInfo);
	        }

	        if (extra === null && !root[k].keys) {
	          return true;
	        }

	        if (k !== '/') { _seen.push(k); }
	        splat = _isSplat;
	        root = root[k];
	        found = true;
	        return true;
	      }

	      return false;
	    });

	    if (!(found || root.keys.some(function (k) { return root[k].pattern.match(x); }))) {
	      throw new defaultExport(key, x);
	    }

	    return splat || !found;
	  });
	  return out;
	}
	function find(path, routes, retries) {
	  var get = reduce.bind(null, path, routes);
	  var set = [];

	  while (retries > 0) {
	    retries -= 1;

	    try {
	      return get(set);
	    } catch (e) {
	      if (retries > 0) {
	        return get(set);
	      }

	      throw e;
	    }
	  }
	}
	function add(path, routes, parent, routeInfo) {
	  var fullpath = merge(path, parent);
	  var root = routes;
	  var key;

	  if (routeInfo && routeInfo.nested !== true) {
	    key = routeInfo.key;
	    delete routeInfo.key;
	  }

	  walk(fullpath, function (x, leaf) {
	    root = PathMatcher.push(x, root, leaf, fullpath);

	    if (x !== '/') {
	      root.info = root.info || Object.assign({}, routeInfo);
	    }
	  });
	  root.info = root.info || Object.assign({}, routeInfo);

	  if (key) {
	    root.info.key = key;
	  }

	  return fullpath;
	}
	function rm(path, routes, parent) {
	  var fullpath = merge(path, parent);
	  var root = routes;
	  var leaf = null;
	  var key = null;
	  walk(fullpath, function (x) {
	    if (!root) {
	      leaf = null;
	      return true;
	    }

	    if (!root.keys) {
	      throw new defaultExport(path, x);
	    }

	    key = x;
	    leaf = root;
	    root = root[key];
	  });

	  if (!(leaf && key)) {
	    throw new defaultExport(path, key);
	  }

	  if (leaf === routes) {
	    leaf = routes['/'];
	  }

	  if (leaf.route !== key) {
	    var offset = leaf.keys.indexOf(key);

	    if (offset === -1) {
	      throw new defaultExport(path, key);
	    }

	    leaf.keys.splice(offset, 1);
	    PathMatcher.sort(leaf);
	    delete leaf[key];
	  }

	  if (root.route === leaf.route) {
	    delete leaf.info;
	  }
	}

	var Router = function Router() {
	  var routes = {};
	  var stack = [];
	  return {
	    resolve: function (path, cb) {
	      var url = path.split('?')[0];
	      var seen = [];
	      walk(url, function (x, leaf, extra) {
	        try {
	          cb(null, find(leaf, routes, 1).filter(function (r) {
	            if (!seen.includes(r.route)) {
	              seen.push(r.route);
	              return true;
	            }

	            return false;
	          }));
	        } catch (e) {
	          cb(e, []);
	        }
	      });
	    },
	    mount: function (path, cb) {
	      if (path !== '/') {
	        stack.push(path);
	      }

	      cb();
	      stack.pop();
	    },
	    find: function (path, retries) { return find(path, routes, retries === true ? 2 : retries || 1); },
	    add: function (path, routeInfo) { return add(path, routes, stack.join(''), routeInfo); },
	    rm: function (path) { return rm(path, routes, stack.join('')); }
	  };
	};

	Router.matches = function matches (uri, path) {
	  return buildMatcher(uri, path).regex.test(path);
	};

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	var strictUriEncode = str => encodeURIComponent(str).replace(/[!'()*]/g, x => `%${x.charCodeAt(0).toString(16).toUpperCase()}`);

	var token = '%[a-f0-9]{2}';
	var singleMatcher = new RegExp(token, 'gi');
	var multiMatcher = new RegExp('(' + token + ')+', 'gi');

	function decodeComponents(components, split) {
		try {
			// Try to decode the entire string first
			return decodeURIComponent(components.join(''));
		} catch (err) {
			// Do nothing
		}

		if (components.length === 1) {
			return components;
		}

		split = split || 1;

		// Split the array in 2 parts
		var left = components.slice(0, split);
		var right = components.slice(split);

		return Array.prototype.concat.call([], decodeComponents(left), decodeComponents(right));
	}

	function decode(input) {
		try {
			return decodeURIComponent(input);
		} catch (err) {
			var tokens = input.match(singleMatcher);

			for (var i = 1; i < tokens.length; i++) {
				input = decodeComponents(tokens, i).join('');

				tokens = input.match(singleMatcher);
			}

			return input;
		}
	}

	function customDecodeURIComponent(input) {
		// Keep track of all the replacements and prefill the map with the `BOM`
		var replaceMap = {
			'%FE%FF': '\uFFFD\uFFFD',
			'%FF%FE': '\uFFFD\uFFFD'
		};

		var match = multiMatcher.exec(input);
		while (match) {
			try {
				// Decode as big chunks as possible
				replaceMap[match[0]] = decodeURIComponent(match[0]);
			} catch (err) {
				var result = decode(match[0]);

				if (result !== match[0]) {
					replaceMap[match[0]] = result;
				}
			}

			match = multiMatcher.exec(input);
		}

		// Add `%C2` at the end of the map to make sure it does not replace the combinator before everything else
		replaceMap['%C2'] = '\uFFFD';

		var entries = Object.keys(replaceMap);

		for (var i = 0; i < entries.length; i++) {
			// Replace all decoded components
			var key = entries[i];
			input = input.replace(new RegExp(key, 'g'), replaceMap[key]);
		}

		return input;
	}

	var decodeUriComponent = function (encodedURI) {
		if (typeof encodedURI !== 'string') {
			throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encodedURI + '`');
		}

		try {
			encodedURI = encodedURI.replace(/\+/g, ' ');

			// Try the built in decoder first
			return decodeURIComponent(encodedURI);
		} catch (err) {
			// Fallback to a more advanced decoder
			return customDecodeURIComponent(encodedURI);
		}
	};

	var splitOnFirst = (string, separator) => {
		if (!(typeof string === 'string' && typeof separator === 'string')) {
			throw new TypeError('Expected the arguments to be of type `string`');
		}

		if (separator === '') {
			return [string];
		}

		const separatorIndex = string.indexOf(separator);

		if (separatorIndex === -1) {
			return [string];
		}

		return [
			string.slice(0, separatorIndex),
			string.slice(separatorIndex + separator.length)
		];
	};

	var queryString = createCommonjsModule(function (module, exports) {




	function encoderForArrayFormat(options) {
		switch (options.arrayFormat) {
			case 'index':
				return key => (result, value) => {
					const index = result.length;
					if (value === undefined || (options.skipNull && value === null)) {
						return result;
					}

					if (value === null) {
						return [...result, [encode(key, options), '[', index, ']'].join('')];
					}

					return [
						...result,
						[encode(key, options), '[', encode(index, options), ']=', encode(value, options)].join('')
					];
				};

			case 'bracket':
				return key => (result, value) => {
					if (value === undefined || (options.skipNull && value === null)) {
						return result;
					}

					if (value === null) {
						return [...result, [encode(key, options), '[]'].join('')];
					}

					return [...result, [encode(key, options), '[]=', encode(value, options)].join('')];
				};

			case 'comma':
			case 'separator':
				return key => (result, value) => {
					if (value === null || value === undefined || value.length === 0) {
						return result;
					}

					if (result.length === 0) {
						return [[encode(key, options), '=', encode(value, options)].join('')];
					}

					return [[result, encode(value, options)].join(options.arrayFormatSeparator)];
				};

			default:
				return key => (result, value) => {
					if (value === undefined || (options.skipNull && value === null)) {
						return result;
					}

					if (value === null) {
						return [...result, encode(key, options)];
					}

					return [...result, [encode(key, options), '=', encode(value, options)].join('')];
				};
		}
	}

	function parserForArrayFormat(options) {
		let result;

		switch (options.arrayFormat) {
			case 'index':
				return (key, value, accumulator) => {
					result = /\[(\d*)\]$/.exec(key);

					key = key.replace(/\[\d*\]$/, '');

					if (!result) {
						accumulator[key] = value;
						return;
					}

					if (accumulator[key] === undefined) {
						accumulator[key] = {};
					}

					accumulator[key][result[1]] = value;
				};

			case 'bracket':
				return (key, value, accumulator) => {
					result = /(\[\])$/.exec(key);
					key = key.replace(/\[\]$/, '');

					if (!result) {
						accumulator[key] = value;
						return;
					}

					if (accumulator[key] === undefined) {
						accumulator[key] = [value];
						return;
					}

					accumulator[key] = [].concat(accumulator[key], value);
				};

			case 'comma':
			case 'separator':
				return (key, value, accumulator) => {
					const isArray = typeof value === 'string' && value.split('').indexOf(options.arrayFormatSeparator) > -1;
					const newValue = isArray ? value.split(options.arrayFormatSeparator).map(item => decode(item, options)) : value === null ? value : decode(value, options);
					accumulator[key] = newValue;
				};

			default:
				return (key, value, accumulator) => {
					if (accumulator[key] === undefined) {
						accumulator[key] = value;
						return;
					}

					accumulator[key] = [].concat(accumulator[key], value);
				};
		}
	}

	function validateArrayFormatSeparator(value) {
		if (typeof value !== 'string' || value.length !== 1) {
			throw new TypeError('arrayFormatSeparator must be single character string');
		}
	}

	function encode(value, options) {
		if (options.encode) {
			return options.strict ? strictUriEncode(value) : encodeURIComponent(value);
		}

		return value;
	}

	function decode(value, options) {
		if (options.decode) {
			return decodeUriComponent(value);
		}

		return value;
	}

	function keysSorter(input) {
		if (Array.isArray(input)) {
			return input.sort();
		}

		if (typeof input === 'object') {
			return keysSorter(Object.keys(input))
				.sort((a, b) => Number(a) - Number(b))
				.map(key => input[key]);
		}

		return input;
	}

	function removeHash(input) {
		const hashStart = input.indexOf('#');
		if (hashStart !== -1) {
			input = input.slice(0, hashStart);
		}

		return input;
	}

	function getHash(url) {
		let hash = '';
		const hashStart = url.indexOf('#');
		if (hashStart !== -1) {
			hash = url.slice(hashStart);
		}

		return hash;
	}

	function extract(input) {
		input = removeHash(input);
		const queryStart = input.indexOf('?');
		if (queryStart === -1) {
			return '';
		}

		return input.slice(queryStart + 1);
	}

	function parseValue(value, options) {
		if (options.parseNumbers && !Number.isNaN(Number(value)) && (typeof value === 'string' && value.trim() !== '')) {
			value = Number(value);
		} else if (options.parseBooleans && value !== null && (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')) {
			value = value.toLowerCase() === 'true';
		}

		return value;
	}

	function parse(input, options) {
		options = Object.assign({
			decode: true,
			sort: true,
			arrayFormat: 'none',
			arrayFormatSeparator: ',',
			parseNumbers: false,
			parseBooleans: false
		}, options);

		validateArrayFormatSeparator(options.arrayFormatSeparator);

		const formatter = parserForArrayFormat(options);

		// Create an object with no prototype
		const ret = Object.create(null);

		if (typeof input !== 'string') {
			return ret;
		}

		input = input.trim().replace(/^[?#&]/, '');

		if (!input) {
			return ret;
		}

		for (const param of input.split('&')) {
			let [key, value] = splitOnFirst(options.decode ? param.replace(/\+/g, ' ') : param, '=');

			// Missing `=` should be `null`:
			// http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
			value = value === undefined ? null : options.arrayFormat === 'comma' ? value : decode(value, options);
			formatter(decode(key, options), value, ret);
		}

		for (const key of Object.keys(ret)) {
			const value = ret[key];
			if (typeof value === 'object' && value !== null) {
				for (const k of Object.keys(value)) {
					value[k] = parseValue(value[k], options);
				}
			} else {
				ret[key] = parseValue(value, options);
			}
		}

		if (options.sort === false) {
			return ret;
		}

		return (options.sort === true ? Object.keys(ret).sort() : Object.keys(ret).sort(options.sort)).reduce((result, key) => {
			const value = ret[key];
			if (Boolean(value) && typeof value === 'object' && !Array.isArray(value)) {
				// Sort object keys, not values
				result[key] = keysSorter(value);
			} else {
				result[key] = value;
			}

			return result;
		}, Object.create(null));
	}

	exports.extract = extract;
	exports.parse = parse;

	exports.stringify = (object, options) => {
		if (!object) {
			return '';
		}

		options = Object.assign({
			encode: true,
			strict: true,
			arrayFormat: 'none',
			arrayFormatSeparator: ','
		}, options);

		validateArrayFormatSeparator(options.arrayFormatSeparator);

		const formatter = encoderForArrayFormat(options);

		const objectCopy = Object.assign({}, object);
		if (options.skipNull) {
			for (const key of Object.keys(objectCopy)) {
				if (objectCopy[key] === undefined || objectCopy[key] === null) {
					delete objectCopy[key];
				}
			}
		}

		const keys = Object.keys(objectCopy);

		if (options.sort !== false) {
			keys.sort(options.sort);
		}

		return keys.map(key => {
			const value = object[key];

			if (value === undefined) {
				return '';
			}

			if (value === null) {
				return encode(key, options);
			}

			if (Array.isArray(value)) {
				return value
					.reduce(formatter(key), [])
					.join('&');
			}

			return encode(key, options) + '=' + encode(value, options);
		}).filter(x => x.length > 0).join('&');
	};

	exports.parseUrl = (input, options) => {
		return {
			url: removeHash(input).split('?')[0] || '',
			query: parse(extract(input), options)
		};
	};

	exports.stringifyUrl = (input, options) => {
		const url = removeHash(input.url).split('?')[0] || '';
		const queryFromUrl = exports.extract(input.url);
		const parsedQueryFromUrl = exports.parse(queryFromUrl);
		const hash = getHash(input.url);
		const query = Object.assign(parsedQueryFromUrl, input.query);
		let queryString = exports.stringify(query, options);
		if (queryString) {
			queryString = `?${queryString}`;
		}

		return `${url}${queryString}${hash}`;
	};
	});
	var queryString_1 = queryString.extract;
	var queryString_2 = queryString.parse;
	var queryString_3 = queryString.stringify;
	var queryString_4 = queryString.parseUrl;
	var queryString_5 = queryString.stringifyUrl;

	const cache = {};
	const baseTag = document.getElementsByTagName('base');
	const basePrefix = (baseTag[0] && baseTag[0].href.replace(/\/$/, '')) || '/';

	const ROOT_URL = basePrefix.replace(window.location.origin, '');

	const router = writable({
	  path: '/',
	  query: {},
	  params: {},
	});

	const CTX_ROUTER = {};
	const CTX_ROUTE = {};

	// use location.hash on embedded pages, e.g. Svelte REPL
	let HASHCHANGE = window.location.origin === 'null';

	function hashchangeEnable(value) {
	  if (typeof value === 'boolean') {
	    HASHCHANGE = !!value;
	  }

	  return HASHCHANGE;
	}

	function fixedLocation(path, callback, doFinally) {
	  const baseUri = hashchangeEnable() ? window.location.hash.replace('#', '') : window.location.pathname;

	  // this will rebase anchors to avoid location changes
	  if (path.charAt() !== '/') {
	    path = baseUri + path;
	  }

	  const currentURL = baseUri + window.location.hash + window.location.search;

	  // do not change location et all...
	  if (currentURL !== path) {
	    callback(path);
	  }

	  // invoke final guard regardless of previous result
	  if (typeof doFinally === 'function') {
	    doFinally();
	  }
	}

	function navigateTo(path, options) {
	  const {
	    reload, replace,
	    params, queryParams,
	  } = options || {};

	  // If path empty or no string, throws error
	  if (!path || typeof path !== 'string' || (path[0] !== '/' && path[0] !== '#')) {
	    throw new Error(`Expecting '/${path}' or '#${path}', given '${path}'`);
	  }

	  if (params) {
	    path = path.replace(/:([a-zA-Z][a-zA-Z0-9_-]*)/g, (_, key) => params[key]);
	  }

	  // rebase active URL
	  if (ROOT_URL !== '/' && path.indexOf(ROOT_URL) !== 0) {
	    path = ROOT_URL + path;
	  }

	  if (queryParams) {
	    const qs = queryString.stringify(queryParams);

	    if (qs) {
	      path += `?${qs}`;
	    }
	  }

	  if (hashchangeEnable()) {
	    window.location.hash = path.replace(/^#/, '');
	    return;
	  }

	  // If no History API support, fallbacks to URL redirect
	  if (reload || !window.history.pushState || !window.dispatchEvent) {
	    window.location.href = path;
	    return;
	  }

	  // If has History API support, uses it
	  fixedLocation(path, nextURL => {
	    window.history[replace ? 'replaceState' : 'pushState'](null, '', nextURL);
	    window.dispatchEvent(new Event('popstate'));
	  });
	}

	function getProps(given, required) {
	  const { props: sub, ...others } = given;

	  // prune all declared props from this component
	  required.forEach(k => {
	    delete others[k];
	  });

	  return {
	    ...sub,
	    ...others,
	  };
	}

	function isActive(uri, path, exact) {
	  if (!cache[[uri, path, exact]]) {
	    if (exact !== true && path.indexOf(uri) === 0) {
	      cache[[uri, path, exact]] = /^[#/?]?$/.test(path.substr(uri.length, 1));
	    } else if (uri.includes('*') || uri.includes(':')) {
	      cache[[uri, path, exact]] = Router.matches(uri, path);
	    } else {
	      cache[[uri, path, exact]] = path === uri;
	    }
	  }

	  return cache[[uri, path, exact]];
	}

	const baseRouter = new Router();
	const routeInfo = writable({});

	// private registries
	const onError = {};
	const shared = {};

	let errors = [];
	let routers = 0;
	let interval;

	// take snapshot from current state...
	router.subscribe(value => { shared.router = value; });
	routeInfo.subscribe(value => { shared.routeInfo = value; });

	function doFallback(failure, fallback) {
	  routeInfo.update(defaults => ({
	    ...defaults,
	    [fallback]: {
	      ...shared.router,
	      failure,
	    },
	  }));
	}

	function handleRoutes(map, params) {
	  const keys = [];

	  map.some(x => {
	    if (x.key && x.matches && !x.fallback && !shared.routeInfo[x.key]) {
	      if (x.redirect && (x.condition === null || x.condition(shared.router) !== true)) {
	        if (x.exact && shared.router.path !== x.path) return false;
	        navigateTo(x.redirect);
	        return true;
	      }

	      if (x.exact) {
	        keys.push(x.key);
	      }

	      // extend shared params...
	      Object.assign(params, x.params);

	      // upgrade matching routes!
	      routeInfo.update(defaults => ({
	        ...defaults,
	        [x.key]: {
	          ...shared.router,
	          ...x,
	        },
	      }));
	    }

	    return false;
	  });

	  return keys;
	}

	function evtHandler() {
	  let baseUri = !hashchangeEnable() ? window.location.href.replace(window.location.origin, '') : window.location.hash || '/';
	  let failure;

	  // unprefix active URL
	  if (ROOT_URL !== '/') {
	    baseUri = baseUri.replace(ROOT_URL, '');
	  }

	  const [fullpath, qs] = baseUri.replace('/#', '#').replace(/^#\//, '/').split('?');
	  const query = queryString.parse(qs);
	  const params = {};
	  const keys = [];

	  // reset current state
	  routeInfo.set({});
	  router.set({
	    query,
	    params,
	    path: fullpath,
	  });

	  // load all matching routes...
	  baseRouter.resolve(fullpath, (err, result) => {
	    if (err) {
	      failure = err;
	      return;
	    }

	    // save exact-keys for deletion after failures!
	    keys.push(...handleRoutes(result, params));
	  });

	  const toDelete = {};

	  if (failure) {
	    keys.reduce((prev, cur) => {
	      prev[cur] = null;
	      return prev;
	    }, toDelete);
	  }

	  // clear previously failed handlers
	  errors.forEach(cb => cb());
	  errors = [];

	  try {
	    // clear routes that not longer matches!
	    baseRouter.find(fullpath).forEach(sub => {
	      if (sub.exact && !sub.matches) {
	        toDelete[sub.key] = null;
	      }
	    });
	  } catch (e) {
	    // this is fine
	  }

	  // drop unwanted routes...
	  routeInfo.update(defaults => ({
	    ...defaults,
	    ...toDelete,
	  }));

	  let fallback;

	  // invoke error-handlers to clear out previous state!
	  Object.keys(onError).forEach(root => {
	    if (isActive(root, fullpath, false)) {
	      const fn = onError[root].callback;

	      fn(failure);
	      errors.push(fn);
	    }

	    if (!fallback && onError[root].fallback) {
	      fallback = onError[root].fallback;
	    }
	  });

	  // handle unmatched fallbacks
	  if (failure && fallback) {
	    doFallback(failure, fallback);
	  }
	}

	function findRoutes() {
	  clearTimeout(interval);
	  interval = setTimeout(evtHandler);
	}

	function addRouter(root, fallback, callback) {
	  if (!routers) {
	    window.addEventListener('popstate', findRoutes, false);
	  }

	  // register error-handlers
	  onError[root] = { fallback, callback };
	  routers += 1;

	  return () => {
	    delete onError[root];
	    routers -= 1;

	    if (!routers) {
	      window.removeEventListener('popstate', findRoutes, false);
	    }
	  };
	}

	/* node_modules/yrv/src/Router.svelte generated by Svelte v3.3.0 */

	function add_css() {
		var style = element("style");
		style.id = 'svelte-kx2cky-style';
		style.textContent = "[data-failure].svelte-kx2cky{border:1px dashed silver}";
		append(document.head, style);
	}

	// (99:0) {#if !disabled}
	function create_if_block_1(ctx) {
		var current;

		const default_slot_1 = ctx.$$slots.default;
		const default_slot = create_slot(default_slot_1, ctx, null);

		return {
			c() {
				if (default_slot) default_slot.c();
			},

			l(nodes) {
				if (default_slot) default_slot.l(nodes);
			},

			m(target, anchor) {
				if (default_slot) {
					default_slot.m(target, anchor);
				}

				current = true;
			},

			p(changed, ctx) {
				if (default_slot && default_slot.p && changed.$$scope) {
					default_slot.p(get_slot_changes(default_slot_1, ctx, changed, null), get_slot_context(default_slot_1, ctx, null));
				}
			},

			i(local) {
				if (current) return;
				if (default_slot && default_slot.i) default_slot.i(local);
				current = true;
			},

			o(local) {
				if (default_slot && default_slot.o) default_slot.o(local);
				current = false;
			},

			d(detaching) {
				if (default_slot) default_slot.d(detaching);
			}
		};
	}

	// (103:0) {#if failure && !fallback && !nofallback}
	function create_if_block(ctx) {
		var fieldset, legend, t0, t1, t2, pre, t3;

		return {
			c() {
				fieldset = element("fieldset");
				legend = element("legend");
				t0 = text("Router failure: ");
				t1 = text(ctx.path);
				t2 = space();
				pre = element("pre");
				t3 = text(ctx.failure);
				fieldset.dataset.failure = true;
				fieldset.className = "svelte-kx2cky";
			},

			m(target, anchor) {
				insert(target, fieldset, anchor);
				append(fieldset, legend);
				append(legend, t0);
				append(legend, t1);
				append(fieldset, t2);
				append(fieldset, pre);
				append(pre, t3);
			},

			p(changed, ctx) {
				if (changed.path) {
					set_data(t1, ctx.path);
				}

				if (changed.failure) {
					set_data(t3, ctx.failure);
				}
			},

			d(detaching) {
				if (detaching) {
					detach(fieldset);
				}
			}
		};
	}

	function create_fragment(ctx) {
		var t, if_block1_anchor, current;

		var if_block0 = (!ctx.disabled) && create_if_block_1(ctx);

		var if_block1 = (ctx.failure && !ctx.fallback && !ctx.nofallback) && create_if_block(ctx);

		return {
			c() {
				if (if_block0) if_block0.c();
				t = space();
				if (if_block1) if_block1.c();
				if_block1_anchor = empty();
			},

			m(target, anchor) {
				if (if_block0) if_block0.m(target, anchor);
				insert(target, t, anchor);
				if (if_block1) if_block1.m(target, anchor);
				insert(target, if_block1_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				if (!ctx.disabled) {
					if (if_block0) {
						if_block0.p(changed, ctx);
						if_block0.i(1);
					} else {
						if_block0 = create_if_block_1(ctx);
						if_block0.c();
						if_block0.i(1);
						if_block0.m(t.parentNode, t);
					}
				} else if (if_block0) {
					group_outros();
					on_outro(() => {
						if_block0.d(1);
						if_block0 = null;
					});

					if_block0.o(1);
					check_outros();
				}

				if (ctx.failure && !ctx.fallback && !ctx.nofallback) {
					if (if_block1) {
						if_block1.p(changed, ctx);
					} else {
						if_block1 = create_if_block(ctx);
						if_block1.c();
						if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
					}
				} else if (if_block1) {
					if_block1.d(1);
					if_block1 = null;
				}
			},

			i(local) {
				if (current) return;
				if (if_block0) if_block0.i();
				current = true;
			},

			o(local) {
				if (if_block0) if_block0.o();
				current = false;
			},

			d(detaching) {
				if (if_block0) if_block0.d(detaching);

				if (detaching) {
					detach(t);
				}

				if (if_block1) if_block1.d(detaching);

				if (detaching) {
					detach(if_block1_anchor);
				}
			}
		};
	}

	function unassignRoute(route) {
	  baseRouter.rm(route);
	  findRoutes();
	}

	function instance($$self, $$props, $$invalidate) {
		let $basePath, $router;

		subscribe($$self, router, $$value => { $router = $$value; $$invalidate('$router', $router); });

		let cleanup;
	  let failure;
	  let fallback;

	  let { path = '/', disabled = false, condition = null, nofallback = false } = $$props;

	  const routerContext = getContext(CTX_ROUTER);
	  const basePath = routerContext ? routerContext.basePath : writable(path); subscribe($$self, basePath, $$value => { $basePath = $$value; $$invalidate('$basePath', $basePath); });

	  const fixedRoot = $basePath !== path && $basePath !== '/'
	    ? `${$basePath}${path !== '/' ? path : ''}`
	    : path;

	  try {
	    if (condition !== null && typeof condition !== 'function') {
	      throw new TypeError(`Expecting condition to be a function, given '${condition}'`);
	    }

	    if (path.charAt() !== '#' && path.charAt() !== '/') {
	      throw new TypeError(`Expecting a leading slash or hash, given '${path}'`);
	    }
	  } catch (e) {
	    $$invalidate('failure', failure = e);
	  }

	  function assignRoute(key, route, detail) {
	    key = key || Math.random().toString(36).substr(2);

	    // consider as nested routes if they does not have any segment
	    const nested = !route.substr(1).includes('/');
	    const handler = { key, nested, ...detail };

	    let fullpath;

	    baseRouter.mount(fixedRoot, () => {
	      fullpath = baseRouter.add(route, handler);
	      $$invalidate('fallback', fallback = (handler.fallback && key) || fallback);
	    });

	    findRoutes();

	    return [key, fullpath];
	  }

	  function onError(err) {
	    $$invalidate('failure', failure = err);

	    if (failure && fallback) {
	      doFallback(failure, fallback);
	    }
	  }

	  onMount(() => {
	    $$invalidate('cleanup', cleanup = addRouter(fixedRoot, fallback, onError));
	  });

	  onDestroy(() => {
	    if (cleanup) cleanup();
	  });

	  setContext(CTX_ROUTER, {
	    basePath,
	    assignRoute,
	    unassignRoute,
	  });

		let { $$slots = {}, $$scope } = $$props;

		$$self.$set = $$props => {
			if ('path' in $$props) $$invalidate('path', path = $$props.path);
			if ('disabled' in $$props) $$invalidate('disabled', disabled = $$props.disabled);
			if ('condition' in $$props) $$invalidate('condition', condition = $$props.condition);
			if ('nofallback' in $$props) $$invalidate('nofallback', nofallback = $$props.nofallback);
			if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
		};

		$$self.$$.update = ($$dirty = { condition: 1, $router: 1 }) => {
			if ($$dirty.condition || $$dirty.$router) { if (condition) {
	        $$invalidate('disabled', disabled = !condition($router));
	      } }
		};

		return {
			failure,
			fallback,
			path,
			disabled,
			condition,
			nofallback,
			basePath,
			$$slots,
			$$scope
		};
	}

	class Router$1 extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-kx2cky-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, ["path", "disabled", "condition", "nofallback"]);
		}
	}

	/* node_modules/yrv/src/Route.svelte generated by Svelte v3.3.0 */

	function add_css$1() {
		var style = element("style");
		style.id = 'svelte-7lze0z-style';
		style.textContent = "[data-failure].svelte-7lze0z{color:red}";
		append(document.head, style);
	}

	const get_default_slot_changes = ({ activeRouter, activeProps }) => ({ router: activeRouter, props: activeProps });
	const get_default_slot_context = ({ activeRouter, activeProps }) => ({
		router: activeRouter,
		props: activeProps
	});

	// (86:0) {#if failure}
	function create_if_block_4(ctx) {
		var p, t;

		return {
			c() {
				p = element("p");
				t = text(ctx.failure);
				p.dataset.failure = true;
				p.className = "svelte-7lze0z";
			},

			m(target, anchor) {
				insert(target, p, anchor);
				append(p, t);
			},

			p(changed, ctx) {
				if (changed.failure) {
					set_data(t, ctx.failure);
				}
			},

			d(detaching) {
				if (detaching) {
					detach(p);
				}
			}
		};
	}

	// (90:0) {#if activeRouter}
	function create_if_block$1(ctx) {
		var current_block_type_index, if_block, if_block_anchor, current;

		var if_block_creators = [
			create_if_block_1$1,
			create_if_block_3,
			create_else_block
		];

		var if_blocks = [];

		function select_block_type(ctx) {
			if (ctx.dynamic) return 0;
			if (ctx.component) return 1;
			return 2;
		}

		current_block_type_index = select_block_type(ctx);
		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

		return {
			c() {
				if_block.c();
				if_block_anchor = empty();
			},

			m(target, anchor) {
				if_blocks[current_block_type_index].m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				var previous_block_index = current_block_type_index;
				current_block_type_index = select_block_type(ctx);
				if (current_block_type_index === previous_block_index) {
					if_blocks[current_block_type_index].p(changed, ctx);
				} else {
					group_outros();
					on_outro(() => {
						if_blocks[previous_block_index].d(1);
						if_blocks[previous_block_index] = null;
					});
					if_block.o(1);
					check_outros();

					if_block = if_blocks[current_block_type_index];
					if (!if_block) {
						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
						if_block.c();
					}
					if_block.i(1);
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			},

			i(local) {
				if (current) return;
				if (if_block) if_block.i();
				current = true;
			},

			o(local) {
				if (if_block) if_block.o();
				current = false;
			},

			d(detaching) {
				if_blocks[current_block_type_index].d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (100:4) {:else}
	function create_else_block(ctx) {
		var current;

		const default_slot_1 = ctx.$$slots.default;
		const default_slot = create_slot(default_slot_1, ctx, get_default_slot_context);

		return {
			c() {
				if (default_slot) default_slot.c();
			},

			l(nodes) {
				if (default_slot) default_slot.l(nodes);
			},

			m(target, anchor) {
				if (default_slot) {
					default_slot.m(target, anchor);
				}

				current = true;
			},

			p(changed, ctx) {
				if (default_slot && default_slot.p && (changed.$$scope || changed.activeRouter || changed.activeProps)) {
					default_slot.p(get_slot_changes(default_slot_1, ctx, changed, get_default_slot_changes), get_slot_context(default_slot_1, ctx, get_default_slot_context));
				}
			},

			i(local) {
				if (current) return;
				if (default_slot && default_slot.i) default_slot.i(local);
				current = true;
			},

			o(local) {
				if (default_slot && default_slot.o) default_slot.o(local);
				current = false;
			},

			d(detaching) {
				if (default_slot) default_slot.d(detaching);
			}
		};
	}

	// (98:4) {#if component}
	function create_if_block_3(ctx) {
		var switch_instance_anchor, current;

		var switch_instance_spread_levels = [
			{ router: ctx.activeRouter },
			ctx.activeProps
		];

		var switch_value = ctx.component;

		function switch_props(ctx) {
			let switch_instance_props = {};
			for (var i = 0; i < switch_instance_spread_levels.length; i += 1) {
				switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
			}
			return { props: switch_instance_props };
		}

		if (switch_value) {
			var switch_instance = new switch_value(switch_props());
		}

		return {
			c() {
				if (switch_instance) switch_instance.$$.fragment.c();
				switch_instance_anchor = empty();
			},

			m(target, anchor) {
				if (switch_instance) {
					mount_component(switch_instance, target, anchor);
				}

				insert(target, switch_instance_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				var switch_instance_changes = (changed.activeRouter || changed.activeProps) ? get_spread_update(switch_instance_spread_levels, [
					(changed.activeRouter) && { router: ctx.activeRouter },
					(changed.activeProps) && ctx.activeProps
				]) : {};

				if (switch_value !== (switch_value = ctx.component)) {
					if (switch_instance) {
						group_outros();
						const old_component = switch_instance;
						on_outro(() => {
							old_component.$destroy();
						});
						old_component.$$.fragment.o(1);
						check_outros();
					}

					if (switch_value) {
						switch_instance = new switch_value(switch_props());

						switch_instance.$$.fragment.c();
						switch_instance.$$.fragment.i(1);
						mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
					} else {
						switch_instance = null;
					}
				}

				else if (switch_value) {
					switch_instance.$set(switch_instance_changes);
				}
			},

			i(local) {
				if (current) return;
				if (switch_instance) switch_instance.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				if (switch_instance) switch_instance.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(switch_instance_anchor);
				}

				if (switch_instance) switch_instance.$destroy(detaching);
			}
		};
	}

	// (91:2) {#if dynamic}
	function create_if_block_1$1(ctx) {
		var await_block_anchor, promise, current;

		let info = {
			ctx,
			current: null,
			pending: create_pending_block,
			then: create_then_block,
			catch: create_catch_block,
			value: 'c',
			error: 'null',
			blocks: Array(3)
		};

		handle_promise(promise = ctx.dynamic, info);

		return {
			c() {
				await_block_anchor = empty();

				info.block.c();
			},

			m(target, anchor) {
				insert(target, await_block_anchor, anchor);

				info.block.m(target, info.anchor = anchor);
				info.mount = () => await_block_anchor.parentNode;
				info.anchor = await_block_anchor;

				current = true;
			},

			p(changed, new_ctx) {
				ctx = new_ctx;
				info.ctx = ctx;

				if (('dynamic' in changed) && promise !== (promise = ctx.dynamic) && handle_promise(promise, info)) ; else {
					info.block.p(changed, assign(assign({}, ctx), info.resolved));
				}
			},

			i(local) {
				if (current) return;
				info.block.i();
				current = true;
			},

			o(local) {
				for (let i = 0; i < 3; i += 1) {
					const block = info.blocks[i];
					if (block) block.o();
				}

				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(await_block_anchor);
				}

				info.block.d(detaching);
				info = null;
			}
		};
	}

	// (1:0) <script context="module">   import { writable }
	function create_catch_block(ctx) {
		return {
			c: noop,
			m: noop,
			p: noop,
			i: noop,
			o: noop,
			d: noop
		};
	}

	// (94:4) {:then c}
	function create_then_block(ctx) {
		var switch_instance_anchor, current;

		var switch_instance_spread_levels = [
			{ router: ctx.activeRouter },
			ctx.activeProps
		];

		var switch_value = ctx.c.default;

		function switch_props(ctx) {
			let switch_instance_props = {};
			for (var i = 0; i < switch_instance_spread_levels.length; i += 1) {
				switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
			}
			return { props: switch_instance_props };
		}

		if (switch_value) {
			var switch_instance = new switch_value(switch_props());
		}

		return {
			c() {
				if (switch_instance) switch_instance.$$.fragment.c();
				switch_instance_anchor = empty();
			},

			m(target, anchor) {
				if (switch_instance) {
					mount_component(switch_instance, target, anchor);
				}

				insert(target, switch_instance_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				var switch_instance_changes = (changed.activeRouter || changed.activeProps) ? get_spread_update(switch_instance_spread_levels, [
					(changed.activeRouter) && { router: ctx.activeRouter },
					(changed.activeProps) && ctx.activeProps
				]) : {};

				if (switch_value !== (switch_value = ctx.c.default)) {
					if (switch_instance) {
						group_outros();
						const old_component = switch_instance;
						on_outro(() => {
							old_component.$destroy();
						});
						old_component.$$.fragment.o(1);
						check_outros();
					}

					if (switch_value) {
						switch_instance = new switch_value(switch_props());

						switch_instance.$$.fragment.c();
						switch_instance.$$.fragment.i(1);
						mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
					} else {
						switch_instance = null;
					}
				}

				else if (switch_value) {
					switch_instance.$set(switch_instance_changes);
				}
			},

			i(local) {
				if (current) return;
				if (switch_instance) switch_instance.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				if (switch_instance) switch_instance.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(switch_instance_anchor);
				}

				if (switch_instance) switch_instance.$destroy(detaching);
			}
		};
	}

	// (92:20)        {#if pending}
	function create_pending_block(ctx) {
		var if_block_anchor;

		var if_block = (ctx.pending) && create_if_block_2(ctx);

		return {
			c() {
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},

			m(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p(changed, ctx) {
				if (ctx.pending) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_2(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (93:6) {#if pending}
	function create_if_block_2(ctx) {
		var t;

		return {
			c() {
				t = text(ctx.pending);
			},

			m(target, anchor) {
				insert(target, t, anchor);
			},

			p(changed, ctx) {
				if (changed.pending) {
					set_data(t, ctx.pending);
				}
			},

			d(detaching) {
				if (detaching) {
					detach(t);
				}
			}
		};
	}

	function create_fragment$1(ctx) {
		var t, if_block1_anchor, current;

		var if_block0 = (ctx.failure) && create_if_block_4(ctx);

		var if_block1 = (ctx.activeRouter) && create_if_block$1(ctx);

		return {
			c() {
				if (if_block0) if_block0.c();
				t = space();
				if (if_block1) if_block1.c();
				if_block1_anchor = empty();
			},

			m(target, anchor) {
				if (if_block0) if_block0.m(target, anchor);
				insert(target, t, anchor);
				if (if_block1) if_block1.m(target, anchor);
				insert(target, if_block1_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				if (ctx.failure) {
					if (if_block0) {
						if_block0.p(changed, ctx);
					} else {
						if_block0 = create_if_block_4(ctx);
						if_block0.c();
						if_block0.m(t.parentNode, t);
					}
				} else if (if_block0) {
					if_block0.d(1);
					if_block0 = null;
				}

				if (ctx.activeRouter) {
					if (if_block1) {
						if_block1.p(changed, ctx);
						if_block1.i(1);
					} else {
						if_block1 = create_if_block$1(ctx);
						if_block1.c();
						if_block1.i(1);
						if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
					}
				} else if (if_block1) {
					group_outros();
					on_outro(() => {
						if_block1.d(1);
						if_block1 = null;
					});

					if_block1.o(1);
					check_outros();
				}
			},

			i(local) {
				if (current) return;
				if (if_block1) if_block1.i();
				current = true;
			},

			o(local) {
				if (if_block1) if_block1.o();
				current = false;
			},

			d(detaching) {
				if (if_block0) if_block0.d(detaching);

				if (detaching) {
					detach(t);
				}

				if (if_block1) if_block1.d(detaching);

				if (detaching) {
					detach(if_block1_anchor);
				}
			}
		};
	}

	function instance$1($$self, $$props, $$invalidate) {
		let $routePath, $routeInfo;

		subscribe($$self, routeInfo, $$value => { $routeInfo = $$value; $$invalidate('$routeInfo', $routeInfo); });

		let { key = null, path = '/', exact = null, dynamic = null, pending = null, disabled = false, fallback = null, component = null, condition = null, redirect = null } = $$props;

	  // replacement for `Object.keys(arguments[0].$$.props)`
	  const thisProps = ['key', 'path', 'exact', 'dynamic', 'pending', 'disabled', 'fallback', 'component', 'condition', 'redirect'];

	  const routeContext = getContext(CTX_ROUTE);
	  const routerContext = getContext(CTX_ROUTER);

	  const { assignRoute, unassignRoute } = routerContext || {};

	  const routePath = routeContext ? routeContext.routePath : writable(path); subscribe($$self, routePath, $$value => { $routePath = $$value; $$invalidate('$routePath', $routePath); });

	  let activeRouter = null;
	  let activeProps = {};
	  let fullpath;
	  let failure;

	  const fixedRoot = $routePath !== path && $routePath !== '/'
	    ? `${$routePath}${path !== '/' ? path : ''}`
	    : path;

	  try {
	    if (redirect !== null && !/^(?:\w+:\/\/|\/)/.test(redirect)) {
	      throw new TypeError(`Expecting valid URL to redirect, given '${redirect}'`);
	    }

	    if (condition !== null && typeof condition !== 'function') {
	      throw new TypeError(`Expecting condition to be a function, given '${condition}'`);
	    }

	    if (path.charAt() !== '#' && path.charAt() !== '/') {
	      throw new TypeError(`Expecting a leading slash or hash, given '${path}'`);
	    }

	    if (!assignRoute) {
	      throw new TypeError(`Missing top-level <Router>, given route: ${path}`);
	    }

	    [key, fullpath] = assignRoute(key, fixedRoot, {
	      condition, redirect, fallback, exact,
	    }); $$invalidate('key', key); $$invalidate('fullpath', fullpath);
	  } catch (e) {
	    $$invalidate('failure', failure = e);
	  }

	  onDestroy(() => {
	    if (unassignRoute) {
	      unassignRoute(fullpath);
	    }
	  });

	  setContext(CTX_ROUTE, {
	    routePath,
	  });

		let { $$slots = {}, $$scope } = $$props;

		$$self.$set = $$new_props => {
			$$invalidate('$$props', $$props = assign(assign({}, $$props), $$new_props));
			if ('key' in $$props) $$invalidate('key', key = $$props.key);
			if ('path' in $$props) $$invalidate('path', path = $$props.path);
			if ('exact' in $$props) $$invalidate('exact', exact = $$props.exact);
			if ('dynamic' in $$props) $$invalidate('dynamic', dynamic = $$props.dynamic);
			if ('pending' in $$props) $$invalidate('pending', pending = $$props.pending);
			if ('disabled' in $$props) $$invalidate('disabled', disabled = $$props.disabled);
			if ('fallback' in $$props) $$invalidate('fallback', fallback = $$props.fallback);
			if ('component' in $$props) $$invalidate('component', component = $$props.component);
			if ('condition' in $$props) $$invalidate('condition', condition = $$props.condition);
			if ('redirect' in $$props) $$invalidate('redirect', redirect = $$props.redirect);
			if ('$$scope' in $$new_props) $$invalidate('$$scope', $$scope = $$new_props.$$scope);
		};

		$$self.$$.update = ($$dirty = { key: 1, disabled: 1, $routeInfo: 1, $$props: 1 }) => {
			if ($$dirty.key || $$dirty.disabled || $$dirty.$routeInfo) { if (key) {
	        $$invalidate('activeRouter', activeRouter = !disabled && $routeInfo[key]);
	        $$invalidate('activeProps', activeProps = getProps($$props, thisProps));
	      } }
		};

		return {
			key,
			path,
			exact,
			dynamic,
			pending,
			disabled,
			fallback,
			component,
			condition,
			redirect,
			routePath,
			activeRouter,
			activeProps,
			failure,
			$$props: $$props = exclude_internal_props($$props),
			$$slots,
			$$scope
		};
	}

	class Route extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-7lze0z-style")) add_css$1();
			init(this, options, instance$1, create_fragment$1, safe_not_equal, ["key", "path", "exact", "dynamic", "pending", "disabled", "fallback", "component", "condition", "redirect"]);
		}
	}

	/* node_modules/yrv/src/Link.svelte generated by Svelte v3.3.0 */

	// (97:0) {:else}
	function create_else_block$1(ctx) {
		var a, current, dispose;

		const default_slot_1 = ctx.$$slots.default;
		const default_slot = create_slot(default_slot_1, ctx, null);

		var a_levels = [
			ctx.fixedProps,
			{ href: ctx.fixedHref || ctx.href },
			{ class: ctx.cssClass },
			{ title: ctx.title }
		];

		var a_data = {};
		for (var i = 0; i < a_levels.length; i += 1) {
			a_data = assign(a_data, a_levels[i]);
		}

		return {
			c() {
				a = element("a");

				if (default_slot) default_slot.c();

				set_attributes(a, a_data);
				dispose = listen(a, "click", prevent_default(ctx.onClick));
			},

			l(nodes) {
				if (default_slot) default_slot.l(a_nodes);
			},

			m(target, anchor) {
				insert(target, a, anchor);

				if (default_slot) {
					default_slot.m(a, null);
				}

				add_binding_callback(() => ctx.a_binding(a, null));
				current = true;
			},

			p(changed, ctx) {
				if (default_slot && default_slot.p && changed.$$scope) {
					default_slot.p(get_slot_changes(default_slot_1, ctx, changed, null), get_slot_context(default_slot_1, ctx, null));
				}

				if (changed.items) {
					ctx.a_binding(null, a);
					ctx.a_binding(a, null);
				}

				set_attributes(a, get_spread_update(a_levels, [
					(changed.fixedProps) && ctx.fixedProps,
					(changed.fixedHref || changed.href) && { href: ctx.fixedHref || ctx.href },
					(changed.cssClass) && { class: ctx.cssClass },
					(changed.title) && { title: ctx.title }
				]));
			},

			i(local) {
				if (current) return;
				if (default_slot && default_slot.i) default_slot.i(local);
				current = true;
			},

			o(local) {
				if (default_slot && default_slot.o) default_slot.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(a);
				}

				if (default_slot) default_slot.d(detaching);
				ctx.a_binding(null, a);
				dispose();
			}
		};
	}

	// (93:0) {#if button}
	function create_if_block$2(ctx) {
		var button_1, current, dispose;

		const default_slot_1 = ctx.$$slots.default;
		const default_slot = create_slot(default_slot_1, ctx, null);

		var button_1_levels = [
			ctx.fixedProps,
			{ class: ctx.cssClass },
			{ title: ctx.title }
		];

		var button_1_data = {};
		for (var i = 0; i < button_1_levels.length; i += 1) {
			button_1_data = assign(button_1_data, button_1_levels[i]);
		}

		return {
			c() {
				button_1 = element("button");

				if (default_slot) default_slot.c();

				set_attributes(button_1, button_1_data);
				dispose = listen(button_1, "click", prevent_default(ctx.onClick));
			},

			l(nodes) {
				if (default_slot) default_slot.l(button_1_nodes);
			},

			m(target, anchor) {
				insert(target, button_1, anchor);

				if (default_slot) {
					default_slot.m(button_1, null);
				}

				add_binding_callback(() => ctx.button_1_binding(button_1, null));
				current = true;
			},

			p(changed, ctx) {
				if (default_slot && default_slot.p && changed.$$scope) {
					default_slot.p(get_slot_changes(default_slot_1, ctx, changed, null), get_slot_context(default_slot_1, ctx, null));
				}

				if (changed.items) {
					ctx.button_1_binding(null, button_1);
					ctx.button_1_binding(button_1, null);
				}

				set_attributes(button_1, get_spread_update(button_1_levels, [
					(changed.fixedProps) && ctx.fixedProps,
					(changed.cssClass) && { class: ctx.cssClass },
					(changed.title) && { title: ctx.title }
				]));
			},

			i(local) {
				if (current) return;
				if (default_slot && default_slot.i) default_slot.i(local);
				current = true;
			},

			o(local) {
				if (default_slot && default_slot.o) default_slot.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(button_1);
				}

				if (default_slot) default_slot.d(detaching);
				ctx.button_1_binding(null, button_1);
				dispose();
			}
		};
	}

	function create_fragment$2(ctx) {
		var current_block_type_index, if_block, if_block_anchor, current;

		var if_block_creators = [
			create_if_block$2,
			create_else_block$1
		];

		var if_blocks = [];

		function select_block_type(ctx) {
			if (ctx.button) return 0;
			return 1;
		}

		current_block_type_index = select_block_type(ctx);
		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

		return {
			c() {
				if_block.c();
				if_block_anchor = empty();
			},

			m(target, anchor) {
				if_blocks[current_block_type_index].m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				var previous_block_index = current_block_type_index;
				current_block_type_index = select_block_type(ctx);
				if (current_block_type_index === previous_block_index) {
					if_blocks[current_block_type_index].p(changed, ctx);
				} else {
					group_outros();
					on_outro(() => {
						if_blocks[previous_block_index].d(1);
						if_blocks[previous_block_index] = null;
					});
					if_block.o(1);
					check_outros();

					if_block = if_blocks[current_block_type_index];
					if (!if_block) {
						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
						if_block.c();
					}
					if_block.i(1);
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			},

			i(local) {
				if (current) return;
				if (if_block) if_block.i();
				current = true;
			},

			o(local) {
				if (if_block) if_block.o();
				current = false;
			},

			d(detaching) {
				if_blocks[current_block_type_index].d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	function instance$2($$self, $$props, $$invalidate) {
		let $router;

		subscribe($$self, router, $$value => { $router = $$value; $$invalidate('$router', $router); });

		

	  let ref;
	  let active;
	  let { class: cssClass = '' } = $$props;
	  let fixedHref = null;

	  let { go = null, open = null, href = '/', title = '', button = false, exact = false, reload = false, replace = false } = $$props;

	  // replacement for `Object.keys(arguments[0].$$.props)`
	  const thisProps = ['go', 'open', 'href', 'class', 'title', 'button', 'exact', 'reload', 'replace'];

	  const dispatch = createEventDispatcher();

	  // this will enable `<Link on:click={...} />` calls
	  function onClick(e) {
	    if (typeof go === 'string' && window.history.length > 1) {
	      if (go === 'back') window.history.back();
	      else if (go === 'fwd') window.history.forward();
	      else window.history.go(parseInt(go, 10));
	      return;
	    }

	    if (!fixedHref) {
	      if (open) {
	        let specs = typeof open === 'string' ? open : '';

	        const wmatch = specs.match(/width=(\d+)/);
	        const hmatch = specs.match(/height=(\d+)/);

	        if (wmatch) specs += `,left=${(window.screen.width - wmatch[1]) / 2}`;
	        if (hmatch) specs += `,top=${(window.screen.height - hmatch[1]) / 2}`;

	        if (wmatch && !hmatch) {
	          specs += `,height=${wmatch[1]},top=${(window.screen.height - wmatch[1]) / 2}`;
	        }

	        const w = window.open(href, '', specs);
	        const t = setInterval(() => {
	          if (w.closed) {
	            dispatch('close');
	            clearInterval(t);
	          }
	        }, 120);
	      } else window.location.href = href;
	      return;
	    }

	    fixedLocation(href, nextURL => {
	      navigateTo(nextURL, { reload, replace });
	    }, () => dispatch('click', e));
	  }

		let { $$slots = {}, $$scope } = $$props;

		function button_1_binding($$node, check) {
			ref = $$node;
			$$invalidate('ref', ref);
		}

		function a_binding($$node, check) {
			ref = $$node;
			$$invalidate('ref', ref);
		}

		$$self.$set = $$new_props => {
			$$invalidate('$$props', $$props = assign(assign({}, $$props), $$new_props));
			if ('class' in $$props) $$invalidate('cssClass', cssClass = $$props.class);
			if ('go' in $$props) $$invalidate('go', go = $$props.go);
			if ('open' in $$props) $$invalidate('open', open = $$props.open);
			if ('href' in $$props) $$invalidate('href', href = $$props.href);
			if ('title' in $$props) $$invalidate('title', title = $$props.title);
			if ('button' in $$props) $$invalidate('button', button = $$props.button);
			if ('exact' in $$props) $$invalidate('exact', exact = $$props.exact);
			if ('reload' in $$props) $$invalidate('reload', reload = $$props.reload);
			if ('replace' in $$props) $$invalidate('replace', replace = $$props.replace);
			if ('$$scope' in $$new_props) $$invalidate('$$scope', $$scope = $$new_props.$$scope);
		};

		let fixedProps;

		$$self.$$.update = ($$dirty = { href: 1, ref: 1, $router: 1, exact: 1, active: 1, button: 1, $$props: 1 }) => {
			if ($$dirty.href) { if (!/^(\w+:)?\/\//.test(href)) {
	        $$invalidate('fixedHref', fixedHref = ROOT_URL + href);
	      } }
			if ($$dirty.ref || $$dirty.$router || $$dirty.href || $$dirty.exact || $$dirty.active || $$dirty.button) { if (ref && $router.path) {
	        if (isActive(href, $router.path, exact)) {
	          if (!active) {
	            $$invalidate('active', active = true);
	            ref.setAttribute('aria-current', 'page');
	    
	            if (button) {
	              ref.setAttribute('disabled', true);
	            }
	          }
	        } else if (active) {
	          $$invalidate('active', active = false);
	          ref.removeAttribute('disabled');
	          ref.removeAttribute('aria-current');
	        }
	      } }
			$$invalidate('fixedProps', fixedProps = getProps($$props, thisProps));
		};

		return {
			ref,
			cssClass,
			fixedHref,
			go,
			open,
			href,
			title,
			button,
			exact,
			reload,
			replace,
			onClick,
			fixedProps,
			button_1_binding,
			a_binding,
			$$props: $$props = exclude_internal_props($$props),
			$$slots,
			$$scope
		};
	}

	class Link extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$2, create_fragment$2, safe_not_equal, ["class", "go", "open", "href", "title", "button", "exact", "reload", "replace"]);
		}
	}

	Object.defineProperty(Router$1, 'hashchange', {
	  set: value => hashchangeEnable(value),
	  get: () => hashchangeEnable(),
	  configurable: false,
	  enumerable: false,
	});

	/* src/app/components/pages/NotFound.svelte generated by Svelte v3.3.0 */

	function create_fragment$3(ctx) {
		var h1;

		return {
			c() {
				h1 = element("h1");
				h1.textContent = "Not found";
			},

			m(target, anchor) {
				insert(target, h1, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(h1);
				}
			}
		};
	}

	class NotFound extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$3, safe_not_equal, []);
		}
	}

	/* src/app/components/pages/Home.svelte generated by Svelte v3.3.0 */

	function create_fragment$4(ctx) {
		var h1;

		return {
			c() {
				h1 = element("h1");
				h1.textContent = "HOME";
			},

			m(target, anchor) {
				insert(target, h1, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(h1);
				}
			}
		};
	}

	class Home extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$4, safe_not_equal, []);
		}
	}

	/* src/app/components/App.svelte generated by Svelte v3.3.0 */

	// (11:6) <Link exact href="/admin/">
	function create_default_slot_2(ctx) {
		var t;

		return {
			c() {
				t = text("Dashboard");
			},

			m(target, anchor) {
				insert(target, t, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(t);
				}
			}
		};
	}

	// (12:8) <Link exact href="/admin/not-found">
	function create_default_slot_1(ctx) {
		var t;

		return {
			c() {
				t = text("Page not found");
			},

			m(target, anchor) {
				insert(target, t, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(t);
				}
			}
		};
	}

	// (8:0) <Router path="/admin">
	function create_default_slot(ctx) {
		var nav1, nav0, t0, t1, main, t2, current;

		var link0 = new Link({
			props: {
			exact: true,
			href: "/admin/",
			$$slots: { default: [create_default_slot_2] },
			$$scope: { ctx }
		}
		});

		var link1 = new Link({
			props: {
			exact: true,
			href: "/admin/not-found",
			$$slots: { default: [create_default_slot_1] },
			$$scope: { ctx }
		}
		});

		var route0 = new Route({
			props: {
			exact: true,
			path: "/",
			component: Home
		}
		});

		var route1 = new Route({
			props: { fallback: true, component: NotFound }
		});

		return {
			c() {
				nav1 = element("nav");
				nav0 = element("nav");
				link0.$$.fragment.c();
				t0 = text("\n      | ");
				link1.$$.fragment.c();
				t1 = space();
				main = element("main");
				route0.$$.fragment.c();
				t2 = space();
				route1.$$.fragment.c();
			},

			m(target, anchor) {
				insert(target, nav1, anchor);
				append(nav1, nav0);
				mount_component(link0, nav0, null);
				append(nav0, t0);
				mount_component(link1, nav0, null);
				insert(target, t1, anchor);
				insert(target, main, anchor);
				mount_component(route0, main, null);
				append(main, t2);
				mount_component(route1, main, null);
				current = true;
			},

			p(changed, ctx) {
				var link0_changes = {};
				if (changed.$$scope) link0_changes.$$scope = { changed, ctx };
				link0.$set(link0_changes);

				var link1_changes = {};
				if (changed.$$scope) link1_changes.$$scope = { changed, ctx };
				link1.$set(link1_changes);

				var route0_changes = {};
				if (changed.Home) route0_changes.component = Home;
				route0.$set(route0_changes);

				var route1_changes = {};
				if (changed.NotFound) route1_changes.component = NotFound;
				route1.$set(route1_changes);
			},

			i(local) {
				if (current) return;
				link0.$$.fragment.i(local);

				link1.$$.fragment.i(local);

				route0.$$.fragment.i(local);

				route1.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				link0.$$.fragment.o(local);
				link1.$$.fragment.o(local);
				route0.$$.fragment.o(local);
				route1.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(nav1);
				}

				link0.$destroy();

				link1.$destroy();

				if (detaching) {
					detach(t1);
					detach(main);
				}

				route0.$destroy();

				route1.$destroy();
			}
		};
	}

	function create_fragment$5(ctx) {
		var current;

		var router = new Router$1({
			props: {
			path: "/admin",
			$$slots: { default: [create_default_slot] },
			$$scope: { ctx }
		}
		});

		return {
			c() {
				router.$$.fragment.c();
			},

			m(target, anchor) {
				mount_component(router, target, anchor);
				current = true;
			},

			p(changed, ctx) {
				var router_changes = {};
				if (changed.$$scope) router_changes.$$scope = { changed, ctx };
				router.$set(router_changes);
			},

			i(local) {
				if (current) return;
				router.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				router.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				router.$destroy(detaching);
			}
		};
	}

	class App extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$5, safe_not_equal, []);
		}
	}

	new App({ // eslint-disable-line
	  target: document.querySelector('#app'),
	});

}());
