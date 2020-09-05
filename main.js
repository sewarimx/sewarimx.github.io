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

	// name=x
	// _replyto=x
	// _subject=x
	// _cc=x,y,z

	// $.ajax({
	//   url: "https://formspree.io/xdowrvjr",
	//   method: "POST",
	//   data: {message: "hello!"},
	//   dataType: "json"
	// });

}());

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC5tanMiLCJub2RlX21vZHVsZXMvc3ZlbHRlL3N0b3JlLm1qcyIsIm5vZGVfbW9kdWxlcy9hYnN0cmFjdC1uZXN0ZWQtcm91dGVyL2Rpc3QvaW5kZXguZXNtLmpzIiwibm9kZV9tb2R1bGVzL3N0cmljdC11cmktZW5jb2RlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2RlY29kZS11cmktY29tcG9uZW50L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3NwbGl0LW9uLWZpcnN0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3F1ZXJ5LXN0cmluZy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy95cnYvc3JjL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL3lydi9zcmMvcm91dGVyLmpzIiwibm9kZV9tb2R1bGVzL3lydi9zcmMvUm91dGVyLnN2ZWx0ZSIsIm5vZGVfbW9kdWxlcy95cnYvc3JjL1JvdXRlLnN2ZWx0ZSIsIm5vZGVfbW9kdWxlcy95cnYvc3JjL0xpbmsuc3ZlbHRlIiwibm9kZV9tb2R1bGVzL3lydi9zcmMvaW5kZXguanMiLCJzcmMvYXBwL2NvbXBvbmVudHMvQXBwLnN2ZWx0ZSIsInNyYy9hcHAvbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkge31cblxuY29uc3QgaWRlbnRpdHkgPSB4ID0+IHg7XG5cbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuXHRmb3IgKGNvbnN0IGsgaW4gc3JjKSB0YXJba10gPSBzcmNba107XG5cdHJldHVybiB0YXI7XG59XG5cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZS50aGVuID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBhZGRfbG9jYXRpb24oZWxlbWVudCwgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyKSB7XG5cdGVsZW1lbnQuX19zdmVsdGVfbWV0YSA9IHtcblx0XHRsb2M6IHsgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyIH1cblx0fTtcbn1cblxuZnVuY3Rpb24gcnVuKGZuKSB7XG5cdHJldHVybiBmbigpO1xufVxuXG5mdW5jdGlvbiBibGFua19vYmplY3QoKSB7XG5cdHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpO1xufVxuXG5mdW5jdGlvbiBydW5fYWxsKGZucykge1xuXHRmbnMuZm9yRWFjaChydW4pO1xufVxuXG5mdW5jdGlvbiBpc19mdW5jdGlvbih0aGluZykge1xuXHRyZXR1cm4gdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBzYWZlX25vdF9lcXVhbChhLCBiKSB7XG5cdHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiIHx8ICgoYSAmJiB0eXBlb2YgYSA9PT0gJ29iamVjdCcpIHx8IHR5cGVvZiBhID09PSAnZnVuY3Rpb24nKTtcbn1cblxuZnVuY3Rpb24gbm90X2VxdWFsKGEsIGIpIHtcblx0cmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGI7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlX3N0b3JlKHN0b3JlLCBuYW1lKSB7XG5cdGlmICghc3RvcmUgfHwgdHlwZW9mIHN0b3JlLnN1YnNjcmliZSAhPT0gJ2Z1bmN0aW9uJykge1xuXHRcdHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcblx0fVxufVxuXG5mdW5jdGlvbiBzdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcblx0Y29uc3QgdW5zdWIgPSBzdG9yZS5zdWJzY3JpYmUoY2FsbGJhY2spO1xuXG5cdGNvbXBvbmVudC4kJC5vbl9kZXN0cm95LnB1c2godW5zdWIudW5zdWJzY3JpYmVcblx0XHQ/ICgpID0+IHVuc3ViLnVuc3Vic2NyaWJlKClcblx0XHQ6IHVuc3ViKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX3Nsb3QoZGVmaW5pdGlvbiwgY3R4LCBmbikge1xuXHRpZiAoZGVmaW5pdGlvbikge1xuXHRcdGNvbnN0IHNsb3RfY3R4ID0gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKTtcblx0XHRyZXR1cm4gZGVmaW5pdGlvblswXShzbG90X2N0eCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jdHgsIGRlZmluaXRpb25bMV0oZm4gPyBmbihjdHgpIDoge30pKSlcblx0XHQ6IGN0eC4kJHNjb3BlLmN0eDtcbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCBjdHgsIGNoYW5nZWQsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jaGFuZ2VkIHx8IHt9LCBkZWZpbml0aW9uWzFdKGZuID8gZm4oY2hhbmdlZCkgOiB7fSkpKVxuXHRcdDogY3R4LiQkc2NvcGUuY2hhbmdlZCB8fCB7fTtcbn1cblxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuXHRjb25zdCByZXN1bHQgPSB7fTtcblx0Zm9yIChjb25zdCBrIGluIHByb3BzKSBpZiAoa1swXSAhPT0gJyQnKSByZXN1bHRba10gPSBwcm9wc1trXTtcblx0cmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdGFza3MgPSBuZXcgU2V0KCk7XG5sZXQgcnVubmluZyA9IGZhbHNlO1xuXG5mdW5jdGlvbiBydW5fdGFza3MoKSB7XG5cdHRhc2tzLmZvckVhY2godGFzayA9PiB7XG5cdFx0aWYgKCF0YXNrWzBdKHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSkpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHRcdHRhc2tbMV0oKTtcblx0XHR9XG5cdH0pO1xuXG5cdHJ1bm5pbmcgPSB0YXNrcy5zaXplID4gMDtcblx0aWYgKHJ1bm5pbmcpIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW5fdGFza3MpO1xufVxuXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcblx0Ly8gZm9yIHRlc3RpbmcuLi5cblx0dGFza3MuZm9yRWFjaCh0YXNrID0+IHRhc2tzLmRlbGV0ZSh0YXNrKSk7XG5cdHJ1bm5pbmcgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gbG9vcChmbikge1xuXHRsZXQgdGFzaztcblxuXHRpZiAoIXJ1bm5pbmcpIHtcblx0XHRydW5uaW5nID0gdHJ1ZTtcblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuX3Rhc2tzKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cHJvbWlzZTogbmV3IFByb21pc2UoZnVsZmlsID0+IHtcblx0XHRcdHRhc2tzLmFkZCh0YXNrID0gW2ZuLCBmdWxmaWxdKTtcblx0XHR9KSxcblx0XHRhYm9ydCgpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGFwcGVuZCh0YXJnZXQsIG5vZGUpIHtcblx0dGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcblx0dGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IgfHwgbnVsbCk7XG59XG5cbmZ1bmN0aW9uIGRldGFjaChub2RlKSB7XG5cdG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbn1cblxuZnVuY3Rpb24gZGV0YWNoX2JldHdlZW4oYmVmb3JlLCBhZnRlcikge1xuXHR3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nICYmIGJlZm9yZS5uZXh0U2libGluZyAhPT0gYWZ0ZXIpIHtcblx0XHRiZWZvcmUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChiZWZvcmUubmV4dFNpYmxpbmcpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9iZWZvcmUoYWZ0ZXIpIHtcblx0d2hpbGUgKGFmdGVyLnByZXZpb3VzU2libGluZykge1xuXHRcdGFmdGVyLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXRhY2hfYWZ0ZXIoYmVmb3JlKSB7XG5cdHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcpIHtcblx0XHRiZWZvcmUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChiZWZvcmUubmV4dFNpYmxpbmcpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3lfZWFjaChpdGVyYXRpb25zLCBkZXRhY2hpbmcpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBpdGVyYXRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0aWYgKGl0ZXJhdGlvbnNbaV0pIGl0ZXJhdGlvbnNbaV0uZChkZXRhY2hpbmcpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGVsZW1lbnQobmFtZSkge1xuXHRyZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKTtcbn1cblxuZnVuY3Rpb24gb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcyhvYmosIGV4Y2x1ZGUpIHtcblx0Y29uc3QgdGFyZ2V0ID0ge307XG5cdGZvciAoY29uc3QgayBpbiBvYmopIHtcblx0XHRpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwgaykgJiYgZXhjbHVkZS5pbmRleE9mKGspID09PSAtMSkge1xuXHRcdFx0dGFyZ2V0W2tdID0gb2JqW2tdO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gdGFyZ2V0O1xufVxuXG5mdW5jdGlvbiBzdmdfZWxlbWVudChuYW1lKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoJ2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJywgbmFtZSk7XG59XG5cbmZ1bmN0aW9uIHRleHQoZGF0YSkge1xuXHRyZXR1cm4gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoZGF0YSk7XG59XG5cbmZ1bmN0aW9uIHNwYWNlKCkge1xuXHRyZXR1cm4gdGV4dCgnICcpO1xufVxuXG5mdW5jdGlvbiBlbXB0eSgpIHtcblx0cmV0dXJuIHRleHQoJycpO1xufVxuXG5mdW5jdGlvbiBsaXN0ZW4obm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpIHtcblx0bm9kZS5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcblx0cmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5cbmZ1bmN0aW9uIHByZXZlbnRfZGVmYXVsdChmbikge1xuXHRyZXR1cm4gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXHRcdHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcblx0fTtcbn1cblxuZnVuY3Rpb24gc3RvcF9wcm9wYWdhdGlvbihmbikge1xuXHRyZXR1cm4gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcblx0XHRyZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG5cdH07XG59XG5cbmZ1bmN0aW9uIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcblx0ZWxzZSBub2RlLnNldEF0dHJpYnV0ZShhdHRyaWJ1dGUsIHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc2V0X2F0dHJpYnV0ZXMobm9kZSwgYXR0cmlidXRlcykge1xuXHRmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG5cdFx0aWYgKGtleSA9PT0gJ3N0eWxlJykge1xuXHRcdFx0bm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuXHRcdH0gZWxzZSBpZiAoa2V5IGluIG5vZGUpIHtcblx0XHRcdG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0YXR0cihub2RlLCBrZXksIGF0dHJpYnV0ZXNba2V5XSk7XG5cdFx0fVxuXHR9XG59XG5cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG5cdGlmIChwcm9wIGluIG5vZGUpIHtcblx0XHRub2RlW3Byb3BdID0gdmFsdWU7XG5cdH0gZWxzZSB7XG5cdFx0YXR0cihub2RlLCBwcm9wLCB2YWx1ZSk7XG5cdH1cbn1cblxuZnVuY3Rpb24geGxpbmtfYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG5cdG5vZGUuc2V0QXR0cmlidXRlTlMoJ2h0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsnLCBhdHRyaWJ1dGUsIHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUoZ3JvdXApIHtcblx0Y29uc3QgdmFsdWUgPSBbXTtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGlmIChncm91cFtpXS5jaGVja2VkKSB2YWx1ZS5wdXNoKGdyb3VwW2ldLl9fdmFsdWUpO1xuXHR9XG5cdHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdG9fbnVtYmVyKHZhbHVlKSB7XG5cdHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHRpbWVfcmFuZ2VzX3RvX2FycmF5KHJhbmdlcykge1xuXHRjb25zdCBhcnJheSA9IFtdO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG5cdH1cblx0cmV0dXJuIGFycmF5O1xufVxuXG5mdW5jdGlvbiBjaGlsZHJlbihlbGVtZW50KSB7XG5cdHJldHVybiBBcnJheS5mcm9tKGVsZW1lbnQuY2hpbGROb2Rlcyk7XG59XG5cbmZ1bmN0aW9uIGNsYWltX2VsZW1lbnQobm9kZXMsIG5hbWUsIGF0dHJpYnV0ZXMsIHN2Zykge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuXHRcdGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG5cdFx0XHRmb3IgKGxldCBqID0gMDsgaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGg7IGogKz0gMSkge1xuXHRcdFx0XHRjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG5cdFx0XHRcdGlmICghYXR0cmlidXRlc1thdHRyaWJ1dGUubmFtZV0pIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcblx0XHRcdH1cblx0XHRcdHJldHVybiBub2Rlcy5zcGxpY2UoaSwgMSlbMF07IC8vIFRPRE8gc3RyaXAgdW53YW50ZWQgYXR0cmlidXRlc1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIGNsYWltX3RleHQobm9kZXMsIGRhdGEpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG5vZGUgPSBub2Rlc1tpXTtcblx0XHRpZiAobm9kZS5ub2RlVHlwZSA9PT0gMykge1xuXHRcdFx0bm9kZS5kYXRhID0gZGF0YTtcblx0XHRcdHJldHVybiBub2Rlcy5zcGxpY2UoaSwgMSlbMF07XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHRleHQoZGF0YSk7XG59XG5cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcblx0ZGF0YSA9ICcnICsgZGF0YTtcblx0aWYgKHRleHQuZGF0YSAhPT0gZGF0YSkgdGV4dC5kYXRhID0gZGF0YTtcbn1cblxuZnVuY3Rpb24gc2V0X2lucHV0X3R5cGUoaW5wdXQsIHR5cGUpIHtcblx0dHJ5IHtcblx0XHRpbnB1dC50eXBlID0gdHlwZTtcblx0fSBjYXRjaCAoZSkge1xuXHRcdC8vIGRvIG5vdGhpbmdcblx0fVxufVxuXG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSkge1xuXHRub2RlLnN0eWxlLnNldFByb3BlcnR5KGtleSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9uKHNlbGVjdCwgdmFsdWUpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG9wdGlvbiA9IHNlbGVjdC5vcHRpb25zW2ldO1xuXG5cdFx0aWYgKG9wdGlvbi5fX3ZhbHVlID09PSB2YWx1ZSkge1xuXHRcdFx0b3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdH1cbn1cblxuZnVuY3Rpb24gc2VsZWN0X29wdGlvbnMoc2VsZWN0LCB2YWx1ZSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG5cdFx0b3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcblx0Y29uc3Qgc2VsZWN0ZWRfb3B0aW9uID0gc2VsZWN0LnF1ZXJ5U2VsZWN0b3IoJzpjaGVja2VkJykgfHwgc2VsZWN0Lm9wdGlvbnNbMF07XG5cdHJldHVybiBzZWxlY3RlZF9vcHRpb24gJiYgc2VsZWN0ZWRfb3B0aW9uLl9fdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9tdWx0aXBsZV92YWx1ZShzZWxlY3QpIHtcblx0cmV0dXJuIFtdLm1hcC5jYWxsKHNlbGVjdC5xdWVyeVNlbGVjdG9yQWxsKCc6Y2hlY2tlZCcpLCBvcHRpb24gPT4gb3B0aW9uLl9fdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBhZGRfcmVzaXplX2xpc3RlbmVyKGVsZW1lbnQsIGZuKSB7XG5cdGlmIChnZXRDb21wdXRlZFN0eWxlKGVsZW1lbnQpLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuXHRcdGVsZW1lbnQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuXHR9XG5cblx0Y29uc3Qgb2JqZWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb2JqZWN0Jyk7XG5cdG9iamVjdC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgJ2Rpc3BsYXk6IGJsb2NrOyBwb3NpdGlvbjogYWJzb2x1dGU7IHRvcDogMDsgbGVmdDogMDsgaGVpZ2h0OiAxMDAlOyB3aWR0aDogMTAwJTsgb3ZlcmZsb3c6IGhpZGRlbjsgcG9pbnRlci1ldmVudHM6IG5vbmU7IHotaW5kZXg6IC0xOycpO1xuXHRvYmplY3QudHlwZSA9ICd0ZXh0L2h0bWwnO1xuXG5cdGxldCB3aW47XG5cblx0b2JqZWN0Lm9ubG9hZCA9ICgpID0+IHtcblx0XHR3aW4gPSBvYmplY3QuY29udGVudERvY3VtZW50LmRlZmF1bHRWaWV3O1xuXHRcdHdpbi5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG5cdH07XG5cblx0aWYgKC9UcmlkZW50Ly50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpKSB7XG5cdFx0ZWxlbWVudC5hcHBlbmRDaGlsZChvYmplY3QpO1xuXHRcdG9iamVjdC5kYXRhID0gJ2Fib3V0OmJsYW5rJztcblx0fSBlbHNlIHtcblx0XHRvYmplY3QuZGF0YSA9ICdhYm91dDpibGFuayc7XG5cdFx0ZWxlbWVudC5hcHBlbmRDaGlsZChvYmplY3QpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRjYW5jZWw6ICgpID0+IHtcblx0XHRcdHdpbiAmJiB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lciAmJiB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xuXHRcdFx0ZWxlbWVudC5yZW1vdmVDaGlsZChvYmplY3QpO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuXHRlbGVtZW50LmNsYXNzTGlzdFt0b2dnbGUgPyAnYWRkJyA6ICdyZW1vdmUnXShuYW1lKTtcbn1cblxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuXHRjb25zdCBlID0gZG9jdW1lbnQuY3JlYXRlRXZlbnQoJ0N1c3RvbUV2ZW50Jyk7XG5cdGUuaW5pdEN1c3RvbUV2ZW50KHR5cGUsIGZhbHNlLCBmYWxzZSwgZGV0YWlsKTtcblx0cmV0dXJuIGU7XG59XG5cbmxldCBzdHlsZXNoZWV0O1xubGV0IGFjdGl2ZSA9IDA7XG5sZXQgY3VycmVudF9ydWxlcyA9IHt9O1xuXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZGFya3NreWFwcC9zdHJpbmctaGFzaC9ibG9iL21hc3Rlci9pbmRleC5qc1xuZnVuY3Rpb24gaGFzaChzdHIpIHtcblx0bGV0IGhhc2ggPSA1MzgxO1xuXHRsZXQgaSA9IHN0ci5sZW5ndGg7XG5cblx0d2hpbGUgKGktLSkgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG5cdHJldHVybiBoYXNoID4+PiAwO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG5cdGNvbnN0IHN0ZXAgPSAxNi42NjYgLyBkdXJhdGlvbjtcblx0bGV0IGtleWZyYW1lcyA9ICd7XFxuJztcblxuXHRmb3IgKGxldCBwID0gMDsgcCA8PSAxOyBwICs9IHN0ZXApIHtcblx0XHRjb25zdCB0ID0gYSArIChiIC0gYSkgKiBlYXNlKHApO1xuXHRcdGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG5cdH1cblxuXHRjb25zdCBydWxlID0ga2V5ZnJhbWVzICsgYDEwMCUgeyR7Zm4oYiwgMSAtIGIpfX1cXG59YDtcblx0Y29uc3QgbmFtZSA9IGBfX3N2ZWx0ZV8ke2hhc2gocnVsZSl9XyR7dWlkfWA7XG5cblx0aWYgKCFjdXJyZW50X3J1bGVzW25hbWVdKSB7XG5cdFx0aWYgKCFzdHlsZXNoZWV0KSB7XG5cdFx0XHRjb25zdCBzdHlsZSA9IGVsZW1lbnQoJ3N0eWxlJyk7XG5cdFx0XHRkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcblx0XHRcdHN0eWxlc2hlZXQgPSBzdHlsZS5zaGVldDtcblx0XHR9XG5cblx0XHRjdXJyZW50X3J1bGVzW25hbWVdID0gdHJ1ZTtcblx0XHRzdHlsZXNoZWV0Lmluc2VydFJ1bGUoYEBrZXlmcmFtZXMgJHtuYW1lfSAke3J1bGV9YCwgc3R5bGVzaGVldC5jc3NSdWxlcy5sZW5ndGgpO1xuXHR9XG5cblx0Y29uc3QgYW5pbWF0aW9uID0gbm9kZS5zdHlsZS5hbmltYXRpb24gfHwgJyc7XG5cdG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuXG5cdGFjdGl2ZSArPSAxO1xuXHRyZXR1cm4gbmFtZTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuXHRub2RlLnN0eWxlLmFuaW1hdGlvbiA9IChub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJylcblx0XHQuc3BsaXQoJywgJylcblx0XHQuZmlsdGVyKG5hbWVcblx0XHRcdD8gYW5pbSA9PiBhbmltLmluZGV4T2YobmFtZSkgPCAwIC8vIHJlbW92ZSBzcGVjaWZpYyBhbmltYXRpb25cblx0XHRcdDogYW5pbSA9PiBhbmltLmluZGV4T2YoJ19fc3ZlbHRlJykgPT09IC0xIC8vIHJlbW92ZSBhbGwgU3ZlbHRlIGFuaW1hdGlvbnNcblx0XHQpXG5cdFx0LmpvaW4oJywgJyk7XG5cblx0aWYgKG5hbWUgJiYgIS0tYWN0aXZlKSBjbGVhcl9ydWxlcygpO1xufVxuXG5mdW5jdGlvbiBjbGVhcl9ydWxlcygpIHtcblx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcblx0XHRpZiAoYWN0aXZlKSByZXR1cm47XG5cdFx0bGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcblx0XHR3aGlsZSAoaS0tKSBzdHlsZXNoZWV0LmRlbGV0ZVJ1bGUoaSk7XG5cdFx0Y3VycmVudF9ydWxlcyA9IHt9O1xuXHR9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2FuaW1hdGlvbihub2RlLCBmcm9tLCBmbiwgcGFyYW1zKSB7XG5cdGlmICghZnJvbSkgcmV0dXJuIG5vb3A7XG5cblx0Y29uc3QgdG8gPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSkgcmV0dXJuIG5vb3A7XG5cblx0Y29uc3Qge1xuXHRcdGRlbGF5ID0gMCxcblx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRzdGFydDogc3RhcnRfdGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5LFxuXHRcdGVuZCA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbixcblx0XHR0aWNrID0gbm9vcCxcblx0XHRjc3Ncblx0fSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcblxuXHRsZXQgcnVubmluZyA9IHRydWU7XG5cdGxldCBzdGFydGVkID0gZmFsc2U7XG5cdGxldCBuYW1lO1xuXG5cdGNvbnN0IGNzc190ZXh0ID0gbm9kZS5zdHlsZS5jc3NUZXh0O1xuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdGlmIChjc3MpIHtcblx0XHRcdGlmIChkZWxheSkgbm9kZS5zdHlsZS5jc3NUZXh0ID0gY3NzX3RleHQ7IC8vIFRPRE8gY3JlYXRlIGRlbGF5ZWQgYW5pbWF0aW9uIGluc3RlYWQ/XG5cdFx0XHRuYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMCwgMSwgZHVyYXRpb24sIDAsIGVhc2luZywgY3NzKTtcblx0XHR9XG5cblx0XHRzdGFydGVkID0gdHJ1ZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHN0b3AoKSB7XG5cdFx0aWYgKGNzcykgZGVsZXRlX3J1bGUobm9kZSwgbmFtZSk7XG5cdFx0cnVubmluZyA9IGZhbHNlO1xuXHR9XG5cblx0bG9vcChub3cgPT4ge1xuXHRcdGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuXHRcdFx0c3RhcnQoKTtcblx0XHR9XG5cblx0XHRpZiAoc3RhcnRlZCAmJiBub3cgPj0gZW5kKSB7XG5cdFx0XHR0aWNrKDEsIDApO1xuXHRcdFx0c3RvcCgpO1xuXHRcdH1cblxuXHRcdGlmICghcnVubmluZykge1xuXHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdH1cblxuXHRcdGlmIChzdGFydGVkKSB7XG5cdFx0XHRjb25zdCBwID0gbm93IC0gc3RhcnRfdGltZTtcblx0XHRcdGNvbnN0IHQgPSAwICsgMSAqIGVhc2luZyhwIC8gZHVyYXRpb24pO1xuXHRcdFx0dGljayh0LCAxIC0gdCk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHRydWU7XG5cdH0pO1xuXG5cdGlmIChkZWxheSkge1xuXHRcdGlmIChjc3MpIG5vZGUuc3R5bGUuY3NzVGV4dCArPSBjc3MoMCwgMSk7XG5cdH0gZWxzZSB7XG5cdFx0c3RhcnQoKTtcblx0fVxuXG5cdHRpY2soMCwgMSk7XG5cblx0cmV0dXJuIHN0b3A7XG59XG5cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG5cdGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcblxuXHRpZiAoc3R5bGUucG9zaXRpb24gIT09ICdhYnNvbHV0ZScgJiYgc3R5bGUucG9zaXRpb24gIT09ICdmaXhlZCcpIHtcblx0XHRjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuXHRcdGNvbnN0IGEgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRcdG5vZGUuc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xuXHRcdG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcblx0XHRub2RlLnN0eWxlLmhlaWdodCA9IGhlaWdodDtcblx0XHRjb25zdCBiID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuXHRcdGlmIChhLmxlZnQgIT09IGIubGVmdCB8fCBhLnRvcCAhPT0gYi50b3ApIHtcblx0XHRcdGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcblx0XHRcdGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG5cblx0XHRcdG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuXHRcdH1cblx0fVxufVxuXG5sZXQgY3VycmVudF9jb21wb25lbnQ7XG5cbmZ1bmN0aW9uIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpIHtcblx0Y3VycmVudF9jb21wb25lbnQgPSBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGdldF9jdXJyZW50X2NvbXBvbmVudCgpIHtcblx0aWYgKCFjdXJyZW50X2NvbXBvbmVudCkgdGhyb3cgbmV3IEVycm9yKGBGdW5jdGlvbiBjYWxsZWQgb3V0c2lkZSBjb21wb25lbnQgaW5pdGlhbGl6YXRpb25gKTtcblx0cmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBiZWZvcmVVcGRhdGUoZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3JlbmRlci5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gb25Nb3VudChmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWZ0ZXJVcGRhdGUoZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfcmVuZGVyLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBvbkRlc3Ryb3koZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlRXZlbnREaXNwYXRjaGVyKCkge1xuXHRjb25zdCBjb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblxuXHRyZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuXHRcdGNvbnN0IGNhbGxiYWNrcyA9IGNvbXBvbmVudC4kJC5jYWxsYmFja3NbdHlwZV07XG5cblx0XHRpZiAoY2FsbGJhY2tzKSB7XG5cdFx0XHQvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG5cdFx0XHQvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG5cdFx0XHRjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuXHRcdFx0Y2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG5cdFx0XHRcdGZuLmNhbGwoY29tcG9uZW50LCBldmVudCk7XG5cdFx0XHR9KTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuc2V0KGtleSwgY29udGV4dCk7XG59XG5cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG5cdHJldHVybiBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5jb250ZXh0LmdldChrZXkpO1xufVxuXG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcblx0Y29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1tldmVudC50eXBlXTtcblxuXHRpZiAoY2FsbGJhY2tzKSB7XG5cdFx0Y2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuXHR9XG59XG5cbmNvbnN0IGRpcnR5X2NvbXBvbmVudHMgPSBbXTtcbmNvbnN0IGludHJvcyA9IHsgZW5hYmxlZDogZmFsc2UgfTtcblxuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmNvbnN0IGJpbmRpbmdfY2FsbGJhY2tzID0gW107XG5jb25zdCByZW5kZXJfY2FsbGJhY2tzID0gW107XG5jb25zdCBmbHVzaF9jYWxsYmFja3MgPSBbXTtcblxuZnVuY3Rpb24gc2NoZWR1bGVfdXBkYXRlKCkge1xuXHRpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcblx0XHR1cGRhdGVfc2NoZWR1bGVkID0gdHJ1ZTtcblx0XHRyZXNvbHZlZF9wcm9taXNlLnRoZW4oZmx1c2gpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHRpY2soKSB7XG5cdHNjaGVkdWxlX3VwZGF0ZSgpO1xuXHRyZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gYWRkX2JpbmRpbmdfY2FsbGJhY2soZm4pIHtcblx0YmluZGluZ19jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcblx0cmVuZGVyX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG5cdGZsdXNoX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gZmx1c2goKSB7XG5cdGNvbnN0IHNlZW5fY2FsbGJhY2tzID0gbmV3IFNldCgpO1xuXG5cdGRvIHtcblx0XHQvLyBmaXJzdCwgY2FsbCBiZWZvcmVVcGRhdGUgZnVuY3Rpb25zXG5cdFx0Ly8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG5cdFx0d2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKSB7XG5cdFx0XHRjb25zdCBjb21wb25lbnQgPSBkaXJ0eV9jb21wb25lbnRzLnNoaWZ0KCk7XG5cdFx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcblx0XHRcdHVwZGF0ZShjb21wb25lbnQuJCQpO1xuXHRcdH1cblxuXHRcdHdoaWxlIChiaW5kaW5nX2NhbGxiYWNrcy5sZW5ndGgpIGJpbmRpbmdfY2FsbGJhY2tzLnNoaWZ0KCkoKTtcblxuXHRcdC8vIHRoZW4sIG9uY2UgY29tcG9uZW50cyBhcmUgdXBkYXRlZCwgY2FsbFxuXHRcdC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2Vcblx0XHQvLyBzdWJzZXF1ZW50IHVwZGF0ZXMuLi5cblx0XHR3aGlsZSAocmVuZGVyX2NhbGxiYWNrcy5sZW5ndGgpIHtcblx0XHRcdGNvbnN0IGNhbGxiYWNrID0gcmVuZGVyX2NhbGxiYWNrcy5wb3AoKTtcblx0XHRcdGlmICghc2Vlbl9jYWxsYmFja3MuaGFzKGNhbGxiYWNrKSkge1xuXHRcdFx0XHRjYWxsYmFjaygpO1xuXG5cdFx0XHRcdC8vIC4uLnNvIGd1YXJkIGFnYWluc3QgaW5maW5pdGUgbG9vcHNcblx0XHRcdFx0c2Vlbl9jYWxsYmFja3MuYWRkKGNhbGxiYWNrKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gd2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKTtcblxuXHR3aGlsZSAoZmx1c2hfY2FsbGJhY2tzLmxlbmd0aCkge1xuXHRcdGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuXHR9XG5cblx0dXBkYXRlX3NjaGVkdWxlZCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiB1cGRhdGUoJCQpIHtcblx0aWYgKCQkLmZyYWdtZW50KSB7XG5cdFx0JCQudXBkYXRlKCQkLmRpcnR5KTtcblx0XHRydW5fYWxsKCQkLmJlZm9yZV9yZW5kZXIpO1xuXHRcdCQkLmZyYWdtZW50LnAoJCQuZGlydHksICQkLmN0eCk7XG5cdFx0JCQuZGlydHkgPSBudWxsO1xuXG5cdFx0JCQuYWZ0ZXJfcmVuZGVyLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG5cdH1cbn1cblxubGV0IHByb21pc2U7XG5cbmZ1bmN0aW9uIHdhaXQoKSB7XG5cdGlmICghcHJvbWlzZSkge1xuXHRcdHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblx0XHRwcm9taXNlLnRoZW4oKCkgPT4ge1xuXHRcdFx0cHJvbWlzZSA9IG51bGw7XG5cdFx0fSk7XG5cdH1cblxuXHRyZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG5cdG5vZGUuZGlzcGF0Y2hFdmVudChjdXN0b21fZXZlbnQoYCR7ZGlyZWN0aW9uID8gJ2ludHJvJyA6ICdvdXRybyd9JHtraW5kfWApKTtcbn1cblxubGV0IG91dHJvcztcblxuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuXHRvdXRyb3MgPSB7XG5cdFx0cmVtYWluaW5nOiAwLFxuXHRcdGNhbGxiYWNrczogW11cblx0fTtcbn1cblxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuXHRpZiAoIW91dHJvcy5yZW1haW5pbmcpIHtcblx0XHRydW5fYWxsKG91dHJvcy5jYWxsYmFja3MpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIG9uX291dHJvKGNhbGxiYWNrKSB7XG5cdG91dHJvcy5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9pbl90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cdGxldCBydW5uaW5nID0gZmFsc2U7XG5cdGxldCBhbmltYXRpb25fbmFtZTtcblx0bGV0IHRhc2s7XG5cdGxldCB1aWQgPSAwO1xuXG5cdGZ1bmN0aW9uIGNsZWFudXAoKSB7XG5cdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdH1cblxuXHRmdW5jdGlvbiBnbygpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0aWYgKGNzcykgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzLCB1aWQrKyk7XG5cdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdGNvbnN0IHN0YXJ0X3RpbWUgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheTtcblx0XHRjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcblxuXHRcdGlmICh0YXNrKSB0YXNrLmFib3J0KCk7XG5cdFx0cnVubmluZyA9IHRydWU7XG5cblx0XHR0YXNrID0gbG9vcChub3cgPT4ge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKG5vdyA+PSBlbmRfdGltZSkge1xuXHRcdFx0XHRcdHRpY2skJDEoMSwgMCk7XG5cdFx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRcdHJldHVybiBydW5uaW5nID0gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKHQsIDEgLSB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGxldCBzdGFydGVkID0gZmFsc2U7XG5cblx0cmV0dXJuIHtcblx0XHRzdGFydCgpIHtcblx0XHRcdGlmIChzdGFydGVkKSByZXR1cm47XG5cblx0XHRcdGRlbGV0ZV9ydWxlKG5vZGUpO1xuXG5cdFx0XHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0d2FpdCgpLnRoZW4oZ28pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Z28oKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0aW52YWxpZGF0ZSgpIHtcblx0XHRcdHN0YXJ0ZWQgPSBmYWxzZTtcblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRydW5uaW5nID0gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfb3V0X3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblx0bGV0IHJ1bm5pbmcgPSB0cnVlO1xuXHRsZXQgYW5pbWF0aW9uX25hbWU7XG5cblx0Y29uc3QgZ3JvdXAgPSBvdXRyb3M7XG5cblx0Z3JvdXAucmVtYWluaW5nICs9IDE7XG5cblx0ZnVuY3Rpb24gZ28oKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGlmIChjc3MpIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG5cblx0XHRjb25zdCBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXk7XG5cdFx0Y29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG5cblx0XHRsb29wKG5vdyA9PiB7XG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAobm93ID49IGVuZF90aW1lKSB7XG5cdFx0XHRcdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdFx0XHRcdGlmICghLS1ncm91cC5yZW1haW5pbmcpIHtcblx0XHRcdFx0XHRcdC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG5cdFx0XHRcdFx0XHQvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcblx0XHRcdFx0XHRcdHJ1bl9hbGwoZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKDEgLSB0LCB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0d2FpdCgpLnRoZW4oKCkgPT4ge1xuXHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRnbygpO1xuXHRcdH0pO1xuXHR9IGVsc2Uge1xuXHRcdGdvKCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGVuZChyZXNldCkge1xuXHRcdFx0aWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG5cdFx0XHRcdGNvbmZpZy50aWNrKDEsIDApO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0XHRcdFx0cnVubmluZyA9IGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zLCBpbnRybykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblxuXHRsZXQgdCA9IGludHJvID8gMCA6IDE7XG5cblx0bGV0IHJ1bm5pbmdfcHJvZ3JhbSA9IG51bGw7XG5cdGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRsZXQgYW5pbWF0aW9uX25hbWUgPSBudWxsO1xuXG5cdGZ1bmN0aW9uIGNsZWFyX2FuaW1hdGlvbigpIHtcblx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcblx0XHRjb25zdCBkID0gcHJvZ3JhbS5iIC0gdDtcblx0XHRkdXJhdGlvbiAqPSBNYXRoLmFicyhkKTtcblxuXHRcdHJldHVybiB7XG5cdFx0XHRhOiB0LFxuXHRcdFx0YjogcHJvZ3JhbS5iLFxuXHRcdFx0ZCxcblx0XHRcdGR1cmF0aW9uLFxuXHRcdFx0c3RhcnQ6IHByb2dyYW0uc3RhcnQsXG5cdFx0XHRlbmQ6IHByb2dyYW0uc3RhcnQgKyBkdXJhdGlvbixcblx0XHRcdGdyb3VwOiBwcm9ncmFtLmdyb3VwXG5cdFx0fTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdvKGIpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0Y29uc3QgcHJvZ3JhbSA9IHtcblx0XHRcdHN0YXJ0OiB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheSxcblx0XHRcdGJcblx0XHR9O1xuXG5cdFx0aWYgKCFiKSB7XG5cdFx0XHRwcm9ncmFtLmdyb3VwID0gb3V0cm9zO1xuXHRcdFx0b3V0cm9zLnJlbWFpbmluZyArPSAxO1xuXHRcdH1cblxuXHRcdGlmIChydW5uaW5nX3Byb2dyYW0pIHtcblx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IHByb2dyYW07XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cblx0XHRcdC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuXHRcdFx0aWYgKGNzcykge1xuXHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0YW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzKTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKGIpIHRpY2skJDEoMCwgMSk7XG5cblx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IGluaXQocHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0YWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBiLCAnc3RhcnQnKSk7XG5cblx0XHRcdGxvb3Aobm93ID0+IHtcblx0XHRcdFx0aWYgKHBlbmRpbmdfcHJvZ3JhbSAmJiBub3cgPiBwZW5kaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG5cblx0XHRcdFx0XHRkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG5cblx0XHRcdFx0XHRpZiAoY3NzKSB7XG5cdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgcnVubmluZ19wcm9ncmFtLmIsIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbiwgMCwgZWFzaW5nLCBjb25maWcuY3NzKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtKSB7XG5cdFx0XHRcdFx0aWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG5cdFx0XHRcdFx0XHR0aWNrJCQxKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuXHRcdFx0XHRcdFx0ZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcblxuXHRcdFx0XHRcdFx0aWYgKCFwZW5kaW5nX3Byb2dyYW0pIHtcblx0XHRcdFx0XHRcdFx0Ly8gd2UncmUgZG9uZVxuXHRcdFx0XHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtLmIpIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcblx0XHRcdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcblx0XHRcdFx0XHRcdFx0XHRpZiAoIS0tcnVubmluZ19wcm9ncmFtLmdyb3VwLnJlbWFpbmluZykgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGVsc2UgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRcdGNvbnN0IHAgPSBub3cgLSBydW5uaW5nX3Byb2dyYW0uc3RhcnQ7XG5cdFx0XHRcdFx0XHR0ID0gcnVubmluZ19wcm9ncmFtLmEgKyBydW5uaW5nX3Byb2dyYW0uZCAqIGVhc2luZyhwIC8gcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uKTtcblx0XHRcdFx0XHRcdHRpY2skJDEodCwgMSAtIHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiAhIShydW5uaW5nX3Byb2dyYW0gfHwgcGVuZGluZ19wcm9ncmFtKTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cnVuKGIpIHtcblx0XHRcdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRcdHdhaXQoKS50aGVuKCgpID0+IHtcblx0XHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0XHRnbyhiKTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnbyhiKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gaGFuZGxlX3Byb21pc2UocHJvbWlzZSwgaW5mbykge1xuXHRjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcblxuXHRmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcblx0XHRpZiAoaW5mby50b2tlbiAhPT0gdG9rZW4pIHJldHVybjtcblxuXHRcdGluZm8ucmVzb2x2ZWQgPSBrZXkgJiYgeyBba2V5XTogdmFsdWUgfTtcblxuXHRcdGNvbnN0IGNoaWxkX2N0eCA9IGFzc2lnbihhc3NpZ24oe30sIGluZm8uY3R4KSwgaW5mby5yZXNvbHZlZCk7XG5cdFx0Y29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuXG5cdFx0aWYgKGluZm8uYmxvY2spIHtcblx0XHRcdGlmIChpbmZvLmJsb2Nrcykge1xuXHRcdFx0XHRpbmZvLmJsb2Nrcy5mb3JFYWNoKChibG9jaywgaSkgPT4ge1xuXHRcdFx0XHRcdGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuXHRcdFx0XHRcdFx0Z3JvdXBfb3V0cm9zKCk7XG5cdFx0XHRcdFx0XHRvbl9vdXRybygoKSA9PiB7XG5cdFx0XHRcdFx0XHRcdGJsb2NrLmQoMSk7XG5cdFx0XHRcdFx0XHRcdGluZm8uYmxvY2tzW2ldID0gbnVsbDtcblx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdFx0YmxvY2subygxKTtcblx0XHRcdFx0XHRcdGNoZWNrX291dHJvcygpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRpbmZvLmJsb2NrLmQoMSk7XG5cdFx0XHR9XG5cblx0XHRcdGJsb2NrLmMoKTtcblx0XHRcdGlmIChibG9jay5pKSBibG9jay5pKDEpO1xuXHRcdFx0YmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcblxuXHRcdFx0Zmx1c2goKTtcblx0XHR9XG5cblx0XHRpbmZvLmJsb2NrID0gYmxvY2s7XG5cdFx0aWYgKGluZm8uYmxvY2tzKSBpbmZvLmJsb2Nrc1tpbmRleF0gPSBibG9jaztcblx0fVxuXG5cdGlmIChpc19wcm9taXNlKHByb21pc2UpKSB7XG5cdFx0cHJvbWlzZS50aGVuKHZhbHVlID0+IHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHZhbHVlKTtcblx0XHR9LCBlcnJvciA9PiB7XG5cdFx0XHR1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG5cdFx0aWYgKGluZm8uY3VycmVudCAhPT0gaW5mby5wZW5kaW5nKSB7XG5cdFx0XHR1cGRhdGUoaW5mby5wZW5kaW5nLCAwKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRpZiAoaW5mby5jdXJyZW50ICE9PSBpbmZvLnRoZW4pIHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHByb21pc2UpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0aW5mby5yZXNvbHZlZCA9IHsgW2luZm8udmFsdWVdOiBwcm9taXNlIH07XG5cdH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmQoMSk7XG5cdGxvb2t1cC5kZWxldGUoYmxvY2sua2V5KTtcbn1cblxuZnVuY3Rpb24gb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRvbl9vdXRybygoKSA9PiB7XG5cdFx0ZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcblx0fSk7XG5cblx0YmxvY2subygxKTtcbn1cblxuZnVuY3Rpb24gZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmYoKTtcblx0b3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGNoYW5nZWQsIGdldF9rZXksIGR5bmFtaWMsIGN0eCwgbGlzdCwgbG9va3VwLCBub2RlLCBkZXN0cm95LCBjcmVhdGVfZWFjaF9ibG9jaywgbmV4dCwgZ2V0X2NvbnRleHQpIHtcblx0bGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcblx0bGV0IG4gPSBsaXN0Lmxlbmd0aDtcblxuXHRsZXQgaSA9IG87XG5cdGNvbnN0IG9sZF9pbmRleGVzID0ge307XG5cdHdoaWxlIChpLS0pIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG5cblx0Y29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuXHRjb25zdCBuZXdfbG9va3VwID0gbmV3IE1hcCgpO1xuXHRjb25zdCBkZWx0YXMgPSBuZXcgTWFwKCk7XG5cblx0aSA9IG47XG5cdHdoaWxlIChpLS0pIHtcblx0XHRjb25zdCBjaGlsZF9jdHggPSBnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpO1xuXHRcdGNvbnN0IGtleSA9IGdldF9rZXkoY2hpbGRfY3R4KTtcblx0XHRsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG5cblx0XHRpZiAoIWJsb2NrKSB7XG5cdFx0XHRibG9jayA9IGNyZWF0ZV9lYWNoX2Jsb2NrKGtleSwgY2hpbGRfY3R4KTtcblx0XHRcdGJsb2NrLmMoKTtcblx0XHR9IGVsc2UgaWYgKGR5bmFtaWMpIHtcblx0XHRcdGJsb2NrLnAoY2hhbmdlZCwgY2hpbGRfY3R4KTtcblx0XHR9XG5cblx0XHRuZXdfbG9va3VwLnNldChrZXksIG5ld19ibG9ja3NbaV0gPSBibG9jayk7XG5cblx0XHRpZiAoa2V5IGluIG9sZF9pbmRleGVzKSBkZWx0YXMuc2V0KGtleSwgTWF0aC5hYnMoaSAtIG9sZF9pbmRleGVzW2tleV0pKTtcblx0fVxuXG5cdGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcblx0Y29uc3QgZGlkX21vdmUgPSBuZXcgU2V0KCk7XG5cblx0ZnVuY3Rpb24gaW5zZXJ0KGJsb2NrKSB7XG5cdFx0aWYgKGJsb2NrLmkpIGJsb2NrLmkoMSk7XG5cdFx0YmxvY2subShub2RlLCBuZXh0KTtcblx0XHRsb29rdXAuc2V0KGJsb2NrLmtleSwgYmxvY2spO1xuXHRcdG5leHQgPSBibG9jay5maXJzdDtcblx0XHRuLS07XG5cdH1cblxuXHR3aGlsZSAobyAmJiBuKSB7XG5cdFx0Y29uc3QgbmV3X2Jsb2NrID0gbmV3X2Jsb2Nrc1tuIC0gMV07XG5cdFx0Y29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvIC0gMV07XG5cdFx0Y29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG5cdFx0Y29uc3Qgb2xkX2tleSA9IG9sZF9ibG9jay5rZXk7XG5cblx0XHRpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcblx0XHRcdC8vIGRvIG5vdGhpbmdcblx0XHRcdG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG5cdFx0XHRvLS07XG5cdFx0XHRuLS07XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG5cdFx0XHQvLyByZW1vdmUgb2xkIGJsb2NrXG5cdFx0XHRkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcblx0XHRcdG8tLTtcblx0XHR9XG5cblx0XHRlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG5cdFx0XHRpbnNlcnQobmV3X2Jsb2NrKTtcblx0XHR9XG5cblx0XHRlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcblx0XHRcdG8tLTtcblxuXHRcdH0gZWxzZSBpZiAoZGVsdGFzLmdldChuZXdfa2V5KSA+IGRlbHRhcy5nZXQob2xkX2tleSkpIHtcblx0XHRcdGRpZF9tb3ZlLmFkZChuZXdfa2V5KTtcblx0XHRcdGluc2VydChuZXdfYmxvY2spO1xuXG5cdFx0fSBlbHNlIHtcblx0XHRcdHdpbGxfbW92ZS5hZGQob2xkX2tleSk7XG5cdFx0XHRvLS07XG5cdFx0fVxuXHR9XG5cblx0d2hpbGUgKG8tLSkge1xuXHRcdGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3Nbb107XG5cdFx0aWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSkgZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG5cdH1cblxuXHR3aGlsZSAobikgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcblxuXHRyZXR1cm4gbmV3X2Jsb2Nrcztcbn1cblxuZnVuY3Rpb24gbWVhc3VyZShibG9ja3MpIHtcblx0Y29uc3QgcmVjdHMgPSB7fTtcblx0bGV0IGkgPSBibG9ja3MubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSByZWN0c1tibG9ja3NbaV0ua2V5XSA9IGJsb2Nrc1tpXS5ub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRyZXR1cm4gcmVjdHM7XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuXHRjb25zdCB1cGRhdGUgPSB7fTtcblxuXHRjb25zdCB0b19udWxsX291dCA9IHt9O1xuXHRjb25zdCBhY2NvdW50ZWRfZm9yID0geyAkJHNjb3BlOiAxIH07XG5cblx0bGV0IGkgPSBsZXZlbHMubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSB7XG5cdFx0Y29uc3QgbyA9IGxldmVsc1tpXTtcblx0XHRjb25zdCBuID0gdXBkYXRlc1tpXTtcblxuXHRcdGlmIChuKSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG5cdFx0XHRcdGlmICghKGtleSBpbiBuKSkgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG5cdFx0XHR9XG5cblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG4pIHtcblx0XHRcdFx0aWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcblx0XHRcdFx0XHR1cGRhdGVba2V5XSA9IG5ba2V5XTtcblx0XHRcdFx0XHRhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGxldmVsc1tpXSA9IG47XG5cdFx0fSBlbHNlIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG8pIHtcblx0XHRcdFx0YWNjb3VudGVkX2ZvcltrZXldID0gMTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRmb3IgKGNvbnN0IGtleSBpbiB0b19udWxsX291dCkge1xuXHRcdGlmICghKGtleSBpbiB1cGRhdGUpKSB1cGRhdGVba2V5XSA9IHVuZGVmaW5lZDtcblx0fVxuXG5cdHJldHVybiB1cGRhdGU7XG59XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuXG5mdW5jdGlvbiBzcHJlYWQoYXJncykge1xuXHRjb25zdCBhdHRyaWJ1dGVzID0gT2JqZWN0LmFzc2lnbih7fSwgLi4uYXJncyk7XG5cdGxldCBzdHIgPSAnJztcblxuXHRPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuXHRcdGlmIChpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlci50ZXN0KG5hbWUpKSByZXR1cm47XG5cblx0XHRjb25zdCB2YWx1ZSA9IGF0dHJpYnV0ZXNbbmFtZV07XG5cdFx0aWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybjtcblx0XHRpZiAodmFsdWUgPT09IHRydWUpIHN0ciArPSBcIiBcIiArIG5hbWU7XG5cblx0XHRjb25zdCBlc2NhcGVkID0gU3RyaW5nKHZhbHVlKVxuXHRcdFx0LnJlcGxhY2UoL1wiL2csICcmIzM0OycpXG5cdFx0XHQucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcblxuXHRcdHN0ciArPSBcIiBcIiArIG5hbWUgKyBcIj1cIiArIEpTT04uc3RyaW5naWZ5KGVzY2FwZWQpO1xuXHR9KTtcblxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBlc2NhcGVkID0ge1xuXHQnXCInOiAnJnF1b3Q7Jyxcblx0XCInXCI6ICcmIzM5OycsXG5cdCcmJzogJyZhbXA7Jyxcblx0JzwnOiAnJmx0OycsXG5cdCc+JzogJyZndDsnXG59O1xuXG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuXHRyZXR1cm4gU3RyaW5nKGh0bWwpLnJlcGxhY2UoL1tcIicmPD5dL2csIG1hdGNoID0+IGVzY2FwZWRbbWF0Y2hdKTtcbn1cblxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcblx0bGV0IHN0ciA9ICcnO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0c3RyICs9IGZuKGl0ZW1zW2ldLCBpKTtcblx0fVxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBtaXNzaW5nX2NvbXBvbmVudCA9IHtcblx0JCRyZW5kZXI6ICgpID0+ICcnXG59O1xuXG5mdW5jdGlvbiB2YWxpZGF0ZV9jb21wb25lbnQoY29tcG9uZW50LCBuYW1lKSB7XG5cdGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcblx0XHRpZiAobmFtZSA9PT0gJ3N2ZWx0ZTpjb21wb25lbnQnKSBuYW1lICs9ICcgdGhpcz17Li4ufSc7XG5cdFx0dGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuXHR9XG5cblx0cmV0dXJuIGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcblx0Y29uc29sZS5sb2coYHtAZGVidWd9ICR7ZmlsZSA/IGZpbGUgKyAnICcgOiAnJ30oJHtsaW5lfToke2NvbHVtbn0pYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRjb25zb2xlLmxvZyh2YWx1ZXMpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0cmV0dXJuICcnO1xufVxuXG5sZXQgb25fZGVzdHJveTtcblxuZnVuY3Rpb24gY3JlYXRlX3Nzcl9jb21wb25lbnQoZm4pIHtcblx0ZnVuY3Rpb24gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKSB7XG5cdFx0Y29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdFx0Y29uc3QgJCQgPSB7XG5cdFx0XHRvbl9kZXN0cm95LFxuXHRcdFx0Y29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuXG5cdFx0XHQvLyB0aGVzZSB3aWxsIGJlIGltbWVkaWF0ZWx5IGRpc2NhcmRlZFxuXHRcdFx0b25fbW91bnQ6IFtdLFxuXHRcdFx0YmVmb3JlX3JlbmRlcjogW10sXG5cdFx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdFx0Y2FsbGJhY2tzOiBibGFua19vYmplY3QoKVxuXHRcdH07XG5cblx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoeyAkJCB9KTtcblxuXHRcdGNvbnN0IGh0bWwgPSBmbihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpO1xuXG5cdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuXHRcdHJldHVybiBodG1sO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZW5kZXI6IChwcm9wcyA9IHt9LCBvcHRpb25zID0ge30pID0+IHtcblx0XHRcdG9uX2Rlc3Ryb3kgPSBbXTtcblxuXHRcdFx0Y29uc3QgcmVzdWx0ID0geyBoZWFkOiAnJywgY3NzOiBuZXcgU2V0KCkgfTtcblx0XHRcdGNvbnN0IGh0bWwgPSAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCB7fSwgb3B0aW9ucyk7XG5cblx0XHRcdHJ1bl9hbGwob25fZGVzdHJveSk7XG5cblx0XHRcdHJldHVybiB7XG5cdFx0XHRcdGh0bWwsXG5cdFx0XHRcdGNzczoge1xuXHRcdFx0XHRcdGNvZGU6IEFycmF5LmZyb20ocmVzdWx0LmNzcykubWFwKGNzcyA9PiBjc3MuY29kZSkuam9pbignXFxuJyksXG5cdFx0XHRcdFx0bWFwOiBudWxsIC8vIFRPRE9cblx0XHRcdFx0fSxcblx0XHRcdFx0aGVhZDogcmVzdWx0LmhlYWRcblx0XHRcdH07XG5cdFx0fSxcblxuXHRcdCQkcmVuZGVyXG5cdH07XG59XG5cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuXHRsZXQgdmFsdWU7XG5cdHN0b3JlLnN1YnNjcmliZShfID0+IHZhbHVlID0gXykoKTtcblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBiaW5kKGNvbXBvbmVudCwgbmFtZSwgY2FsbGJhY2spIHtcblx0aWYgKGNvbXBvbmVudC4kJC5wcm9wcy5pbmRleE9mKG5hbWUpID09PSAtMSkgcmV0dXJuO1xuXHRjb21wb25lbnQuJCQuYm91bmRbbmFtZV0gPSBjYWxsYmFjaztcblx0Y2FsbGJhY2soY29tcG9uZW50LiQkLmN0eFtuYW1lXSk7XG59XG5cbmZ1bmN0aW9uIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIHRhcmdldCwgYW5jaG9yKSB7XG5cdGNvbnN0IHsgZnJhZ21lbnQsIG9uX21vdW50LCBvbl9kZXN0cm95LCBhZnRlcl9yZW5kZXIgfSA9IGNvbXBvbmVudC4kJDtcblxuXHRmcmFnbWVudC5tKHRhcmdldCwgYW5jaG9yKTtcblxuXHQvLyBvbk1vdW50IGhhcHBlbnMgYWZ0ZXIgdGhlIGluaXRpYWwgYWZ0ZXJVcGRhdGUuIEJlY2F1c2Vcblx0Ly8gYWZ0ZXJVcGRhdGUgY2FsbGJhY2tzIGhhcHBlbiBpbiByZXZlcnNlIG9yZGVyIChpbm5lciBmaXJzdClcblx0Ly8gd2Ugc2NoZWR1bGUgb25Nb3VudCBjYWxsYmFja3MgYmVmb3JlIGFmdGVyVXBkYXRlIGNhbGxiYWNrc1xuXHRhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IHtcblx0XHRjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG5cdFx0aWYgKG9uX2Rlc3Ryb3kpIHtcblx0XHRcdG9uX2Rlc3Ryb3kucHVzaCguLi5uZXdfb25fZGVzdHJveSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIEVkZ2UgY2FzZSAtIGNvbXBvbmVudCB3YXMgZGVzdHJveWVkIGltbWVkaWF0ZWx5LFxuXHRcdFx0Ly8gbW9zdCBsaWtlbHkgYXMgYSByZXN1bHQgb2YgYSBiaW5kaW5nIGluaXRpYWxpc2luZ1xuXHRcdFx0cnVuX2FsbChuZXdfb25fZGVzdHJveSk7XG5cdFx0fVxuXHRcdGNvbXBvbmVudC4kJC5vbl9tb3VudCA9IFtdO1xuXHR9KTtcblxuXHRhZnRlcl9yZW5kZXIuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gZGVzdHJveShjb21wb25lbnQsIGRldGFjaGluZykge1xuXHRpZiAoY29tcG9uZW50LiQkKSB7XG5cdFx0cnVuX2FsbChjb21wb25lbnQuJCQub25fZGVzdHJveSk7XG5cdFx0Y29tcG9uZW50LiQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcblxuXHRcdC8vIFRPRE8gbnVsbCBvdXQgb3RoZXIgcmVmcywgaW5jbHVkaW5nIGNvbXBvbmVudC4kJCAoYnV0IG5lZWQgdG9cblx0XHQvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG5cdFx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kgPSBjb21wb25lbnQuJCQuZnJhZ21lbnQgPSBudWxsO1xuXHRcdGNvbXBvbmVudC4kJC5jdHggPSB7fTtcblx0fVxufVxuXG5mdW5jdGlvbiBtYWtlX2RpcnR5KGNvbXBvbmVudCwga2V5KSB7XG5cdGlmICghY29tcG9uZW50LiQkLmRpcnR5KSB7XG5cdFx0ZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG5cdFx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdFx0Y29tcG9uZW50LiQkLmRpcnR5ID0gYmxhbmtfb2JqZWN0KCk7XG5cdH1cblx0Y29tcG9uZW50LiQkLmRpcnR5W2tleV0gPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbml0KGNvbXBvbmVudCwgb3B0aW9ucywgaW5zdGFuY2UsIGNyZWF0ZV9mcmFnbWVudCwgbm90X2VxdWFsJCQxLCBwcm9wX25hbWVzKSB7XG5cdGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG5cblx0Y29uc3QgcHJvcHMgPSBvcHRpb25zLnByb3BzIHx8IHt9O1xuXG5cdGNvbnN0ICQkID0gY29tcG9uZW50LiQkID0ge1xuXHRcdGZyYWdtZW50OiBudWxsLFxuXHRcdGN0eDogbnVsbCxcblxuXHRcdC8vIHN0YXRlXG5cdFx0cHJvcHM6IHByb3BfbmFtZXMsXG5cdFx0dXBkYXRlOiBub29wLFxuXHRcdG5vdF9lcXVhbDogbm90X2VxdWFsJCQxLFxuXHRcdGJvdW5kOiBibGFua19vYmplY3QoKSxcblxuXHRcdC8vIGxpZmVjeWNsZVxuXHRcdG9uX21vdW50OiBbXSxcblx0XHRvbl9kZXN0cm95OiBbXSxcblx0XHRiZWZvcmVfcmVuZGVyOiBbXSxcblx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcblxuXHRcdC8vIGV2ZXJ5dGhpbmcgZWxzZVxuXHRcdGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG5cdFx0ZGlydHk6IG51bGxcblx0fTtcblxuXHRsZXQgcmVhZHkgPSBmYWxzZTtcblxuXHQkJC5jdHggPSBpbnN0YW5jZVxuXHRcdD8gaW5zdGFuY2UoY29tcG9uZW50LCBwcm9wcywgKGtleSwgdmFsdWUpID0+IHtcblx0XHRcdGlmICgkJC5jdHggJiYgbm90X2VxdWFsJCQxKCQkLmN0eFtrZXldLCAkJC5jdHhba2V5XSA9IHZhbHVlKSkge1xuXHRcdFx0XHRpZiAoJCQuYm91bmRba2V5XSkgJCQuYm91bmRba2V5XSh2YWx1ZSk7XG5cdFx0XHRcdGlmIChyZWFkeSkgbWFrZV9kaXJ0eShjb21wb25lbnQsIGtleSk7XG5cdFx0XHR9XG5cdFx0fSlcblx0XHQ6IHByb3BzO1xuXG5cdCQkLnVwZGF0ZSgpO1xuXHRyZWFkeSA9IHRydWU7XG5cdHJ1bl9hbGwoJCQuYmVmb3JlX3JlbmRlcik7XG5cdCQkLmZyYWdtZW50ID0gY3JlYXRlX2ZyYWdtZW50KCQkLmN0eCk7XG5cblx0aWYgKG9wdGlvbnMudGFyZ2V0KSB7XG5cdFx0aWYgKG9wdGlvbnMuaHlkcmF0ZSkge1xuXHRcdFx0JCQuZnJhZ21lbnQubChjaGlsZHJlbihvcHRpb25zLnRhcmdldCkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkJC5mcmFnbWVudC5jKCk7XG5cdFx0fVxuXG5cdFx0aWYgKG9wdGlvbnMuaW50cm8gJiYgY29tcG9uZW50LiQkLmZyYWdtZW50LmkpIGNvbXBvbmVudC4kJC5mcmFnbWVudC5pKCk7XG5cdFx0bW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgb3B0aW9ucy50YXJnZXQsIG9wdGlvbnMuYW5jaG9yKTtcblx0XHRmbHVzaCgpO1xuXHR9XG5cblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xufVxuXG5sZXQgU3ZlbHRlRWxlbWVudDtcbmlmICh0eXBlb2YgSFRNTEVsZW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG5cdFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcblx0XHRjb25zdHJ1Y3RvcigpIHtcblx0XHRcdHN1cGVyKCk7XG5cdFx0XHR0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTtcblx0XHR9XG5cblx0XHRjb25uZWN0ZWRDYWxsYmFjaygpIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIHRoaXMuJCQuc2xvdHRlZCkge1xuXHRcdFx0XHR0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciQkMSwgb2xkVmFsdWUsIG5ld1ZhbHVlKSB7XG5cdFx0XHR0aGlzW2F0dHIkJDFdID0gbmV3VmFsdWU7XG5cdFx0fVxuXG5cdFx0JGRlc3Ryb3koKSB7XG5cdFx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdFx0dGhpcy4kZGVzdHJveSA9IG5vb3A7XG5cdFx0fVxuXG5cdFx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0XHQvLyBUT0RPIHNob3VsZCB0aGlzIGRlbGVnYXRlIHRvIGFkZEV2ZW50TGlzdGVuZXI/XG5cdFx0XHRjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcblx0XHRcdGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcblxuXHRcdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdFx0Y29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG5cdFx0XHRcdGlmIChpbmRleCAhPT0gLTEpIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHQkc2V0KCkge1xuXHRcdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdFx0fVxuXHR9O1xufVxuXG5jbGFzcyBTdmVsdGVDb21wb25lbnQge1xuXHQkZGVzdHJveSgpIHtcblx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuXHR9XG5cblx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG5cdFx0Y2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuXG5cdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuXHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0fTtcblx0fVxuXG5cdCRzZXQoKSB7XG5cdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdH1cbn1cblxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50RGV2IGV4dGVuZHMgU3ZlbHRlQ29tcG9uZW50IHtcblx0Y29uc3RydWN0b3Iob3B0aW9ucykge1xuXHRcdGlmICghb3B0aW9ucyB8fCAoIW9wdGlvbnMudGFyZ2V0ICYmICFvcHRpb25zLiQkaW5saW5lKSkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKGAndGFyZ2V0JyBpcyBhIHJlcXVpcmVkIG9wdGlvbmApO1xuXHRcdH1cblxuXHRcdHN1cGVyKCk7XG5cdH1cblxuXHQkZGVzdHJveSgpIHtcblx0XHRzdXBlci4kZGVzdHJveSgpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG5cdFx0XHRjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdFx0fTtcblx0fVxufVxuXG5leHBvcnQgeyBjcmVhdGVfYW5pbWF0aW9uLCBmaXhfcG9zaXRpb24sIGhhbmRsZV9wcm9taXNlLCBhcHBlbmQsIGluc2VydCwgZGV0YWNoLCBkZXRhY2hfYmV0d2VlbiwgZGV0YWNoX2JlZm9yZSwgZGV0YWNoX2FmdGVyLCBkZXN0cm95X2VhY2gsIGVsZW1lbnQsIG9iamVjdF93aXRob3V0X3Byb3BlcnRpZXMsIHN2Z19lbGVtZW50LCB0ZXh0LCBzcGFjZSwgZW1wdHksIGxpc3RlbiwgcHJldmVudF9kZWZhdWx0LCBzdG9wX3Byb3BhZ2F0aW9uLCBhdHRyLCBzZXRfYXR0cmlidXRlcywgc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEsIHhsaW5rX2F0dHIsIGdldF9iaW5kaW5nX2dyb3VwX3ZhbHVlLCB0b19udW1iZXIsIHRpbWVfcmFuZ2VzX3RvX2FycmF5LCBjaGlsZHJlbiwgY2xhaW1fZWxlbWVudCwgY2xhaW1fdGV4dCwgc2V0X2RhdGEsIHNldF9pbnB1dF90eXBlLCBzZXRfc3R5bGUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGVjdF9tdWx0aXBsZV92YWx1ZSwgYWRkX3Jlc2l6ZV9saXN0ZW5lciwgdG9nZ2xlX2NsYXNzLCBjdXN0b21fZXZlbnQsIGRlc3Ryb3lfYmxvY2ssIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCB1cGRhdGVfa2V5ZWRfZWFjaCwgbWVhc3VyZSwgY3VycmVudF9jb21wb25lbnQsIHNldF9jdXJyZW50X2NvbXBvbmVudCwgYmVmb3JlVXBkYXRlLCBvbk1vdW50LCBhZnRlclVwZGF0ZSwgb25EZXN0cm95LCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIHNldENvbnRleHQsIGdldENvbnRleHQsIGJ1YmJsZSwgY2xlYXJfbG9vcHMsIGxvb3AsIGRpcnR5X2NvbXBvbmVudHMsIGludHJvcywgc2NoZWR1bGVfdXBkYXRlLCB0aWNrLCBhZGRfYmluZGluZ19jYWxsYmFjaywgYWRkX3JlbmRlcl9jYWxsYmFjaywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBmbHVzaCwgZ2V0X3NwcmVhZF91cGRhdGUsIGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLCBzcHJlYWQsIGVzY2FwZWQsIGVzY2FwZSwgZWFjaCwgbWlzc2luZ19jb21wb25lbnQsIHZhbGlkYXRlX2NvbXBvbmVudCwgZGVidWcsIGNyZWF0ZV9zc3JfY29tcG9uZW50LCBnZXRfc3RvcmVfdmFsdWUsIGdyb3VwX291dHJvcywgY2hlY2tfb3V0cm9zLCBvbl9vdXRybywgY3JlYXRlX2luX3RyYW5zaXRpb24sIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbiwgY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbiwgbm9vcCwgaWRlbnRpdHksIGFzc2lnbiwgaXNfcHJvbWlzZSwgYWRkX2xvY2F0aW9uLCBydW4sIGJsYW5rX29iamVjdCwgcnVuX2FsbCwgaXNfZnVuY3Rpb24sIHNhZmVfbm90X2VxdWFsLCBub3RfZXF1YWwsIHZhbGlkYXRlX3N0b3JlLCBzdWJzY3JpYmUsIGNyZWF0ZV9zbG90LCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc2xvdF9jaGFuZ2VzLCBleGNsdWRlX2ludGVybmFsX3Byb3BzLCBiaW5kLCBtb3VudF9jb21wb25lbnQsIGluaXQsIFN2ZWx0ZUVsZW1lbnQsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2IH07XG4iLCJpbXBvcnQgeyBydW5fYWxsLCBub29wLCBnZXRfc3RvcmVfdmFsdWUsIHNhZmVfbm90X2VxdWFsIH0gZnJvbSAnLi9pbnRlcm5hbCc7XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkYWJsZSh2YWx1ZSwgc3RhcnQpIHtcblx0cmV0dXJuIHtcblx0XHRzdWJzY3JpYmU6IHdyaXRhYmxlKHZhbHVlLCBzdGFydCkuc3Vic2NyaWJlXG5cdH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0YWJsZSh2YWx1ZSwgc3RhcnQgPSBub29wKSB7XG5cdGxldCBzdG9wO1xuXHRjb25zdCBzdWJzY3JpYmVycyA9IFtdO1xuXG5cdGZ1bmN0aW9uIHNldChuZXdfdmFsdWUpIHtcblx0XHRpZiAoc2FmZV9ub3RfZXF1YWwodmFsdWUsIG5ld192YWx1ZSkpIHtcblx0XHRcdHZhbHVlID0gbmV3X3ZhbHVlO1xuXHRcdFx0aWYgKCFzdG9wKSByZXR1cm47IC8vIG5vdCByZWFkeVxuXHRcdFx0c3Vic2NyaWJlcnMuZm9yRWFjaChzID0+IHNbMV0oKSk7XG5cdFx0XHRzdWJzY3JpYmVycy5mb3JFYWNoKHMgPT4gc1swXSh2YWx1ZSkpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHVwZGF0ZShmbikge1xuXHRcdHNldChmbih2YWx1ZSkpO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3Vic2NyaWJlKHJ1biwgaW52YWxpZGF0ZSA9IG5vb3ApIHtcblx0XHRjb25zdCBzdWJzY3JpYmVyID0gW3J1biwgaW52YWxpZGF0ZV07XG5cdFx0c3Vic2NyaWJlcnMucHVzaChzdWJzY3JpYmVyKTtcblx0XHRpZiAoc3Vic2NyaWJlcnMubGVuZ3RoID09PSAxKSBzdG9wID0gc3RhcnQoc2V0KSB8fCBub29wO1xuXHRcdHJ1bih2YWx1ZSk7XG5cblx0XHRyZXR1cm4gKCkgPT4ge1xuXHRcdFx0Y29uc3QgaW5kZXggPSBzdWJzY3JpYmVycy5pbmRleE9mKHN1YnNjcmliZXIpO1xuXHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgc3Vic2NyaWJlcnMuc3BsaWNlKGluZGV4LCAxKTtcblx0XHRcdGlmIChzdWJzY3JpYmVycy5sZW5ndGggPT09IDApIHN0b3AoKTtcblx0XHR9O1xuXHR9XG5cblx0cmV0dXJuIHsgc2V0LCB1cGRhdGUsIHN1YnNjcmliZSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlZChzdG9yZXMsIGZuLCBpbml0aWFsX3ZhbHVlKSB7XG5cdGNvbnN0IHNpbmdsZSA9ICFBcnJheS5pc0FycmF5KHN0b3Jlcyk7XG5cdGlmIChzaW5nbGUpIHN0b3JlcyA9IFtzdG9yZXNdO1xuXG5cdGNvbnN0IGF1dG8gPSBmbi5sZW5ndGggPCAyO1xuXHRsZXQgdmFsdWUgPSB7fTtcblxuXHRyZXR1cm4gcmVhZGFibGUoaW5pdGlhbF92YWx1ZSwgc2V0ID0+IHtcblx0XHRsZXQgaW5pdGVkID0gZmFsc2U7XG5cdFx0Y29uc3QgdmFsdWVzID0gW107XG5cblx0XHRsZXQgcGVuZGluZyA9IDA7XG5cdFx0bGV0IGNsZWFudXAgPSBub29wO1xuXG5cdFx0Y29uc3Qgc3luYyA9ICgpID0+IHtcblx0XHRcdGlmIChwZW5kaW5nKSByZXR1cm47XG5cdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRjb25zdCByZXN1bHQgPSBmbihzaW5nbGUgPyB2YWx1ZXNbMF0gOiB2YWx1ZXMsIHNldCk7XG5cdFx0XHRpZiAoYXV0bykgc2V0KHJlc3VsdCk7XG5cdFx0XHRlbHNlIGNsZWFudXAgPSByZXN1bHQgfHwgbm9vcDtcblx0XHR9O1xuXG5cdFx0Y29uc3QgdW5zdWJzY3JpYmVycyA9IHN0b3Jlcy5tYXAoKHN0b3JlLCBpKSA9PiBzdG9yZS5zdWJzY3JpYmUoXG5cdFx0XHR2YWx1ZSA9PiB7XG5cdFx0XHRcdHZhbHVlc1tpXSA9IHZhbHVlO1xuXHRcdFx0XHRwZW5kaW5nICY9IH4oMSA8PCBpKTtcblx0XHRcdFx0aWYgKGluaXRlZCkgc3luYygpO1xuXHRcdFx0fSxcblx0XHRcdCgpID0+IHtcblx0XHRcdFx0cGVuZGluZyB8PSAoMSA8PCBpKTtcblx0XHRcdH0pXG5cdFx0KTtcblxuXHRcdGluaXRlZCA9IHRydWU7XG5cdFx0c3luYygpO1xuXG5cdFx0cmV0dXJuIGZ1bmN0aW9uIHN0b3AoKSB7XG5cdFx0XHRydW5fYWxsKHVuc3Vic2NyaWJlcnMpO1xuXHRcdFx0Y2xlYW51cCgpO1xuXHRcdH07XG5cdH0pO1xufVxuXG5leHBvcnQgeyBnZXRfc3RvcmVfdmFsdWUgYXMgZ2V0IH07XG4iLCJ2YXIgZGVmYXVsdEV4cG9ydCA9IC8qQF9fUFVSRV9fKi8oZnVuY3Rpb24gKEVycm9yKSB7XG4gIGZ1bmN0aW9uIGRlZmF1bHRFeHBvcnQocm91dGUsIHBhdGgpIHtcbiAgICB2YXIgbWVzc2FnZSA9IFwiVW5yZWFjaGFibGUgJ1wiICsgcm91dGUgKyBcIicsIHNlZ21lbnQgJ1wiICsgcGF0aCArIFwiJyBpcyBub3QgZGVmaW5lZFwiO1xuICAgIEVycm9yLmNhbGwodGhpcywgbWVzc2FnZSk7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgfVxuXG4gIGlmICggRXJyb3IgKSBkZWZhdWx0RXhwb3J0Ll9fcHJvdG9fXyA9IEVycm9yO1xuICBkZWZhdWx0RXhwb3J0LnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoIEVycm9yICYmIEVycm9yLnByb3RvdHlwZSApO1xuICBkZWZhdWx0RXhwb3J0LnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGRlZmF1bHRFeHBvcnQ7XG5cbiAgcmV0dXJuIGRlZmF1bHRFeHBvcnQ7XG59KEVycm9yKSk7XG5cbmZ1bmN0aW9uIGJ1aWxkTWF0Y2hlcihwYXRoLCBwYXJlbnQpIHtcbiAgdmFyIHJlZ2V4O1xuXG4gIHZhciBfaXNTcGxhdDtcblxuICB2YXIgX3ByaW9yaXR5ID0gLTEwMDtcblxuICB2YXIga2V5cyA9IFtdO1xuICByZWdleCA9IHBhdGgucmVwbGFjZSgvWy0kLl0vZywgJ1xcXFwkJicpLnJlcGxhY2UoL1xcKC9nLCAnKD86JykucmVwbGFjZSgvXFwpL2csICcpPycpLnJlcGxhY2UoLyhbOipdXFx3KykoPzo8KFtePD5dKz8pPik/L2csIGZ1bmN0aW9uIChfLCBrZXksIGV4cHIpIHtcbiAgICBrZXlzLnB1c2goa2V5LnN1YnN0cigxKSk7XG5cbiAgICBpZiAoa2V5LmNoYXJBdCgpID09PSAnOicpIHtcbiAgICAgIF9wcmlvcml0eSArPSAxMDA7XG4gICAgICByZXR1cm4gKFwiKCg/ISMpXCIgKyAoZXhwciB8fCAnW14jL10rPycpICsgXCIpXCIpO1xuICAgIH1cblxuICAgIF9pc1NwbGF0ID0gdHJ1ZTtcbiAgICBfcHJpb3JpdHkgKz0gNTAwO1xuICAgIHJldHVybiAoXCIoKD8hIylcIiArIChleHByIHx8ICdbXiNdKz8nKSArIFwiKVwiKTtcbiAgfSk7XG5cbiAgdHJ5IHtcbiAgICByZWdleCA9IG5ldyBSZWdFeHAoKFwiXlwiICsgcmVnZXggKyBcIiRcIikpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcigoXCJJbnZhbGlkIHJvdXRlIGV4cHJlc3Npb24sIGdpdmVuICdcIiArIHBhcmVudCArIFwiJ1wiKSk7XG4gIH1cblxuICB2YXIgX2hhc2hlZCA9IHBhdGguaW5jbHVkZXMoJyMnKSA/IDAuNSA6IDE7XG5cbiAgdmFyIF9kZXB0aCA9IHBhdGgubGVuZ3RoICogX3ByaW9yaXR5ICogX2hhc2hlZDtcblxuICByZXR1cm4ge1xuICAgIGtleXM6IGtleXMsXG4gICAgcmVnZXg6IHJlZ2V4LFxuICAgIF9kZXB0aDogX2RlcHRoLFxuICAgIF9pc1NwbGF0OiBfaXNTcGxhdFxuICB9O1xufVxudmFyIFBhdGhNYXRjaGVyID0gZnVuY3Rpb24gUGF0aE1hdGNoZXIocGF0aCwgcGFyZW50KSB7XG4gIHZhciByZWYgPSBidWlsZE1hdGNoZXIocGF0aCwgcGFyZW50KTtcbiAgdmFyIGtleXMgPSByZWYua2V5cztcbiAgdmFyIHJlZ2V4ID0gcmVmLnJlZ2V4O1xuICB2YXIgX2RlcHRoID0gcmVmLl9kZXB0aDtcbiAgdmFyIF9pc1NwbGF0ID0gcmVmLl9pc1NwbGF0O1xuICByZXR1cm4ge1xuICAgIF9pc1NwbGF0OiBfaXNTcGxhdCxcbiAgICBfZGVwdGg6IF9kZXB0aCxcbiAgICBtYXRjaDogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IHZhbHVlLm1hdGNoKHJlZ2V4KTtcblxuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgcmV0dXJuIGtleXMucmVkdWNlKGZ1bmN0aW9uIChwcmV2LCBjdXIsIGkpIHtcbiAgICAgICAgICBwcmV2W2N1cl0gPSB0eXBlb2YgbWF0Y2hlc1tpICsgMV0gPT09ICdzdHJpbmcnID8gZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoZXNbaSArIDFdKSA6IG51bGw7XG4gICAgICAgICAgcmV0dXJuIHByZXY7XG4gICAgICAgIH0sIHt9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59O1xuXG5QYXRoTWF0Y2hlci5wdXNoID0gZnVuY3Rpb24gcHVzaCAoa2V5LCBwcmV2LCBsZWFmLCBwYXJlbnQpIHtcbiAgdmFyIHJvb3QgPSBwcmV2W2tleV0gfHwgKHByZXZba2V5XSA9IHt9KTtcblxuICBpZiAoIXJvb3QucGF0dGVybikge1xuICAgIHJvb3QucGF0dGVybiA9IG5ldyBQYXRoTWF0Y2hlcihrZXksIHBhcmVudCk7XG4gICAgcm9vdC5yb3V0ZSA9IChsZWFmIHx8ICcnKS5yZXBsYWNlKC9cXC8kLywgJycpIHx8ICcvJztcbiAgfVxuXG4gIHByZXYua2V5cyA9IHByZXYua2V5cyB8fCBbXTtcblxuICBpZiAoIXByZXYua2V5cy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgcHJldi5rZXlzLnB1c2goa2V5KTtcbiAgICBQYXRoTWF0Y2hlci5zb3J0KHByZXYpO1xuICB9XG5cbiAgcmV0dXJuIHJvb3Q7XG59O1xuXG5QYXRoTWF0Y2hlci5zb3J0ID0gZnVuY3Rpb24gc29ydCAocm9vdCkge1xuICByb290LmtleXMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgIHJldHVybiByb290W2FdLnBhdHRlcm4uX2RlcHRoIC0gcm9vdFtiXS5wYXR0ZXJuLl9kZXB0aDtcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiBtZXJnZShwYXRoLCBwYXJlbnQpIHtcbiAgcmV0dXJuIChcIlwiICsgKHBhcmVudCAmJiBwYXJlbnQgIT09ICcvJyA/IHBhcmVudCA6ICcnKSArIChwYXRoIHx8ICcnKSk7XG59XG5mdW5jdGlvbiB3YWxrKHBhdGgsIGNiKSB7XG4gIHZhciBtYXRjaGVzID0gcGF0aC5tYXRjaCgvPFtePD5dKlxcL1tePD5dKj4vKTtcblxuICBpZiAobWF0Y2hlcykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoKFwiUmVnRXhwIGNhbm5vdCBjb250YWluIHNsYXNoZXMsIGdpdmVuICdcIiArIG1hdGNoZXMgKyBcIidcIikpO1xuICB9XG5cbiAgdmFyIHBhcnRzID0gcGF0aC5zcGxpdCgvKD89XFwvfCMpLyk7XG4gIHZhciByb290ID0gW107XG5cbiAgaWYgKHBhcnRzWzBdICE9PSAnLycpIHtcbiAgICBwYXJ0cy51bnNoaWZ0KCcvJyk7XG4gIH1cblxuICBwYXJ0cy5zb21lKGZ1bmN0aW9uICh4LCBpKSB7XG4gICAgdmFyIHBhcmVudCA9IHJvb3Quc2xpY2UoMSkuY29uY2F0KHgpLmpvaW4oJycpIHx8IG51bGw7XG4gICAgdmFyIHNlZ21lbnQgPSBwYXJ0cy5zbGljZShpICsgMSkuam9pbignJykgfHwgbnVsbDtcbiAgICB2YXIgcmV0dmFsID0gY2IoeCwgcGFyZW50LCBzZWdtZW50ID8gKFwiXCIgKyAoeCAhPT0gJy8nID8geCA6ICcnKSArIHNlZ21lbnQpIDogbnVsbCk7XG4gICAgcm9vdC5wdXNoKHgpO1xuICAgIHJldHVybiByZXR2YWw7XG4gIH0pO1xufVxuZnVuY3Rpb24gcmVkdWNlKGtleSwgcm9vdCwgX3NlZW4pIHtcbiAgdmFyIHBhcmFtcyA9IHt9O1xuICB2YXIgb3V0ID0gW107XG4gIHZhciBzcGxhdDtcbiAgd2FsayhrZXksIGZ1bmN0aW9uICh4LCBsZWFmLCBleHRyYSkge1xuICAgIHZhciBmb3VuZDtcblxuICAgIGlmICghcm9vdC5rZXlzKSB7XG4gICAgICB0aHJvdyBuZXcgZGVmYXVsdEV4cG9ydChrZXksIHgpO1xuICAgIH1cblxuICAgIHJvb3Qua2V5cy5zb21lKGZ1bmN0aW9uIChrKSB7XG4gICAgICBpZiAoX3NlZW4uaW5jbHVkZXMoaykpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICB2YXIgcmVmID0gcm9vdFtrXS5wYXR0ZXJuO1xuICAgICAgdmFyIG1hdGNoID0gcmVmLm1hdGNoO1xuICAgICAgdmFyIF9pc1NwbGF0ID0gcmVmLl9pc1NwbGF0O1xuICAgICAgdmFyIG1hdGNoZXMgPSBtYXRjaChfaXNTcGxhdCA/IGV4dHJhIHx8IHggOiB4KTtcblxuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihwYXJhbXMsIG1hdGNoZXMpO1xuXG4gICAgICAgIGlmIChyb290W2tdLnJvdXRlKSB7XG4gICAgICAgICAgdmFyIHJvdXRlSW5mbyA9IE9iamVjdC5hc3NpZ24oe30sIHJvb3Rba10uaW5mbyk7IC8vIHByb3Blcmx5IGhhbmRsZSBleGFjdC1yb3V0ZXMhXG5cbiAgICAgICAgICB2YXIgaGFzTWF0Y2ggPSBmYWxzZTtcblxuICAgICAgICAgIGlmIChyb3V0ZUluZm8uZXhhY3QpIHtcbiAgICAgICAgICAgIGhhc01hdGNoID0gZXh0cmEgPT09IG51bGw7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGhhc01hdGNoID0gISh4ICYmIGxlYWYgPT09IG51bGwpIHx8IHggPT09IGxlYWYgfHwgX2lzU3BsYXQgfHwgIWV4dHJhO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJvdXRlSW5mby5tYXRjaGVzID0gaGFzTWF0Y2g7XG4gICAgICAgICAgcm91dGVJbmZvLnBhcmFtcyA9IE9iamVjdC5hc3NpZ24oe30sIHBhcmFtcyk7XG4gICAgICAgICAgcm91dGVJbmZvLnJvdXRlID0gcm9vdFtrXS5yb3V0ZTtcbiAgICAgICAgICByb3V0ZUluZm8ucGF0aCA9IF9pc1NwbGF0ICYmIGV4dHJhIHx8IGxlYWYgfHwgeDtcbiAgICAgICAgICBvdXQucHVzaChyb3V0ZUluZm8pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV4dHJhID09PSBudWxsICYmICFyb290W2tdLmtleXMpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChrICE9PSAnLycpIHsgX3NlZW4ucHVzaChrKTsgfVxuICAgICAgICBzcGxhdCA9IF9pc1NwbGF0O1xuICAgICAgICByb290ID0gcm9vdFtrXTtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuXG4gICAgaWYgKCEoZm91bmQgfHwgcm9vdC5rZXlzLnNvbWUoZnVuY3Rpb24gKGspIHsgcmV0dXJuIHJvb3Rba10ucGF0dGVybi5tYXRjaCh4KTsgfSkpKSB7XG4gICAgICB0aHJvdyBuZXcgZGVmYXVsdEV4cG9ydChrZXksIHgpO1xuICAgIH1cblxuICAgIHJldHVybiBzcGxhdCB8fCAhZm91bmQ7XG4gIH0pO1xuICByZXR1cm4gb3V0O1xufVxuZnVuY3Rpb24gZmluZChwYXRoLCByb3V0ZXMsIHJldHJpZXMpIHtcbiAgdmFyIGdldCA9IHJlZHVjZS5iaW5kKG51bGwsIHBhdGgsIHJvdXRlcyk7XG4gIHZhciBzZXQgPSBbXTtcblxuICB3aGlsZSAocmV0cmllcyA+IDApIHtcbiAgICByZXRyaWVzIC09IDE7XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGdldChzZXQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChyZXRyaWVzID4gMCkge1xuICAgICAgICByZXR1cm4gZ2V0KHNldCk7XG4gICAgICB9XG5cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59XG5mdW5jdGlvbiBhZGQocGF0aCwgcm91dGVzLCBwYXJlbnQsIHJvdXRlSW5mbykge1xuICB2YXIgZnVsbHBhdGggPSBtZXJnZShwYXRoLCBwYXJlbnQpO1xuICB2YXIgcm9vdCA9IHJvdXRlcztcbiAgdmFyIGtleTtcblxuICBpZiAocm91dGVJbmZvICYmIHJvdXRlSW5mby5uZXN0ZWQgIT09IHRydWUpIHtcbiAgICBrZXkgPSByb3V0ZUluZm8ua2V5O1xuICAgIGRlbGV0ZSByb3V0ZUluZm8ua2V5O1xuICB9XG5cbiAgd2FsayhmdWxscGF0aCwgZnVuY3Rpb24gKHgsIGxlYWYpIHtcbiAgICByb290ID0gUGF0aE1hdGNoZXIucHVzaCh4LCByb290LCBsZWFmLCBmdWxscGF0aCk7XG5cbiAgICBpZiAoeCAhPT0gJy8nKSB7XG4gICAgICByb290LmluZm8gPSByb290LmluZm8gfHwgT2JqZWN0LmFzc2lnbih7fSwgcm91dGVJbmZvKTtcbiAgICB9XG4gIH0pO1xuICByb290LmluZm8gPSByb290LmluZm8gfHwgT2JqZWN0LmFzc2lnbih7fSwgcm91dGVJbmZvKTtcblxuICBpZiAoa2V5KSB7XG4gICAgcm9vdC5pbmZvLmtleSA9IGtleTtcbiAgfVxuXG4gIHJldHVybiBmdWxscGF0aDtcbn1cbmZ1bmN0aW9uIHJtKHBhdGgsIHJvdXRlcywgcGFyZW50KSB7XG4gIHZhciBmdWxscGF0aCA9IG1lcmdlKHBhdGgsIHBhcmVudCk7XG4gIHZhciByb290ID0gcm91dGVzO1xuICB2YXIgbGVhZiA9IG51bGw7XG4gIHZhciBrZXkgPSBudWxsO1xuICB3YWxrKGZ1bGxwYXRoLCBmdW5jdGlvbiAoeCkge1xuICAgIGlmICghcm9vdCkge1xuICAgICAgbGVhZiA9IG51bGw7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIXJvb3Qua2V5cykge1xuICAgICAgdGhyb3cgbmV3IGRlZmF1bHRFeHBvcnQocGF0aCwgeCk7XG4gICAgfVxuXG4gICAga2V5ID0geDtcbiAgICBsZWFmID0gcm9vdDtcbiAgICByb290ID0gcm9vdFtrZXldO1xuICB9KTtcblxuICBpZiAoIShsZWFmICYmIGtleSkpIHtcbiAgICB0aHJvdyBuZXcgZGVmYXVsdEV4cG9ydChwYXRoLCBrZXkpO1xuICB9XG5cbiAgaWYgKGxlYWYgPT09IHJvdXRlcykge1xuICAgIGxlYWYgPSByb3V0ZXNbJy8nXTtcbiAgfVxuXG4gIGlmIChsZWFmLnJvdXRlICE9PSBrZXkpIHtcbiAgICB2YXIgb2Zmc2V0ID0gbGVhZi5rZXlzLmluZGV4T2Yoa2V5KTtcblxuICAgIGlmIChvZmZzZXQgPT09IC0xKSB7XG4gICAgICB0aHJvdyBuZXcgZGVmYXVsdEV4cG9ydChwYXRoLCBrZXkpO1xuICAgIH1cblxuICAgIGxlYWYua2V5cy5zcGxpY2Uob2Zmc2V0LCAxKTtcbiAgICBQYXRoTWF0Y2hlci5zb3J0KGxlYWYpO1xuICAgIGRlbGV0ZSBsZWFmW2tleV07XG4gIH1cblxuICBpZiAocm9vdC5yb3V0ZSA9PT0gbGVhZi5yb3V0ZSkge1xuICAgIGRlbGV0ZSBsZWFmLmluZm87XG4gIH1cbn1cblxudmFyIFJvdXRlciA9IGZ1bmN0aW9uIFJvdXRlcigpIHtcbiAgdmFyIHJvdXRlcyA9IHt9O1xuICB2YXIgc3RhY2sgPSBbXTtcbiAgcmV0dXJuIHtcbiAgICByZXNvbHZlOiBmdW5jdGlvbiAocGF0aCwgY2IpIHtcbiAgICAgIHZhciB1cmwgPSBwYXRoLnNwbGl0KCc/JylbMF07XG4gICAgICB2YXIgc2VlbiA9IFtdO1xuICAgICAgd2Fsayh1cmwsIGZ1bmN0aW9uICh4LCBsZWFmLCBleHRyYSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNiKG51bGwsIGZpbmQobGVhZiwgcm91dGVzLCAxKS5maWx0ZXIoZnVuY3Rpb24gKHIpIHtcbiAgICAgICAgICAgIGlmICghc2Vlbi5pbmNsdWRlcyhyLnJvdXRlKSkge1xuICAgICAgICAgICAgICBzZWVuLnB1c2goci5yb3V0ZSk7XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfSkpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgY2IoZSwgW10pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LFxuICAgIG1vdW50OiBmdW5jdGlvbiAocGF0aCwgY2IpIHtcbiAgICAgIGlmIChwYXRoICE9PSAnLycpIHtcbiAgICAgICAgc3RhY2sucHVzaChwYXRoKTtcbiAgICAgIH1cblxuICAgICAgY2IoKTtcbiAgICAgIHN0YWNrLnBvcCgpO1xuICAgIH0sXG4gICAgZmluZDogZnVuY3Rpb24gKHBhdGgsIHJldHJpZXMpIHsgcmV0dXJuIGZpbmQocGF0aCwgcm91dGVzLCByZXRyaWVzID09PSB0cnVlID8gMiA6IHJldHJpZXMgfHwgMSk7IH0sXG4gICAgYWRkOiBmdW5jdGlvbiAocGF0aCwgcm91dGVJbmZvKSB7IHJldHVybiBhZGQocGF0aCwgcm91dGVzLCBzdGFjay5qb2luKCcnKSwgcm91dGVJbmZvKTsgfSxcbiAgICBybTogZnVuY3Rpb24gKHBhdGgpIHsgcmV0dXJuIHJtKHBhdGgsIHJvdXRlcywgc3RhY2suam9pbignJykpOyB9XG4gIH07XG59O1xuXG5Sb3V0ZXIubWF0Y2hlcyA9IGZ1bmN0aW9uIG1hdGNoZXMgKHVyaSwgcGF0aCkge1xuICByZXR1cm4gYnVpbGRNYXRjaGVyKHVyaSwgcGF0aCkucmVnZXgudGVzdChwYXRoKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFJvdXRlcjtcbiIsIid1c2Ugc3RyaWN0Jztcbm1vZHVsZS5leHBvcnRzID0gc3RyID0+IGVuY29kZVVSSUNvbXBvbmVudChzdHIpLnJlcGxhY2UoL1shJygpKl0vZywgeCA9PiBgJSR7eC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpfWApO1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIHRva2VuID0gJyVbYS1mMC05XXsyfSc7XG52YXIgc2luZ2xlTWF0Y2hlciA9IG5ldyBSZWdFeHAodG9rZW4sICdnaScpO1xudmFyIG11bHRpTWF0Y2hlciA9IG5ldyBSZWdFeHAoJygnICsgdG9rZW4gKyAnKSsnLCAnZ2knKTtcblxuZnVuY3Rpb24gZGVjb2RlQ29tcG9uZW50cyhjb21wb25lbnRzLCBzcGxpdCkge1xuXHR0cnkge1xuXHRcdC8vIFRyeSB0byBkZWNvZGUgdGhlIGVudGlyZSBzdHJpbmcgZmlyc3Rcblx0XHRyZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGNvbXBvbmVudHMuam9pbignJykpO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBEbyBub3RoaW5nXG5cdH1cblxuXHRpZiAoY29tcG9uZW50cy5sZW5ndGggPT09IDEpIHtcblx0XHRyZXR1cm4gY29tcG9uZW50cztcblx0fVxuXG5cdHNwbGl0ID0gc3BsaXQgfHwgMTtcblxuXHQvLyBTcGxpdCB0aGUgYXJyYXkgaW4gMiBwYXJ0c1xuXHR2YXIgbGVmdCA9IGNvbXBvbmVudHMuc2xpY2UoMCwgc3BsaXQpO1xuXHR2YXIgcmlnaHQgPSBjb21wb25lbnRzLnNsaWNlKHNwbGl0KTtcblxuXHRyZXR1cm4gQXJyYXkucHJvdG90eXBlLmNvbmNhdC5jYWxsKFtdLCBkZWNvZGVDb21wb25lbnRzKGxlZnQpLCBkZWNvZGVDb21wb25lbnRzKHJpZ2h0KSk7XG59XG5cbmZ1bmN0aW9uIGRlY29kZShpbnB1dCkge1xuXHR0cnkge1xuXHRcdHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoaW5wdXQpO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHR2YXIgdG9rZW5zID0gaW5wdXQubWF0Y2goc2luZ2xlTWF0Y2hlcik7XG5cblx0XHRmb3IgKHZhciBpID0gMTsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuXHRcdFx0aW5wdXQgPSBkZWNvZGVDb21wb25lbnRzKHRva2VucywgaSkuam9pbignJyk7XG5cblx0XHRcdHRva2VucyA9IGlucHV0Lm1hdGNoKHNpbmdsZU1hdGNoZXIpO1xuXHRcdH1cblxuXHRcdHJldHVybiBpbnB1dDtcblx0fVxufVxuXG5mdW5jdGlvbiBjdXN0b21EZWNvZGVVUklDb21wb25lbnQoaW5wdXQpIHtcblx0Ly8gS2VlcCB0cmFjayBvZiBhbGwgdGhlIHJlcGxhY2VtZW50cyBhbmQgcHJlZmlsbCB0aGUgbWFwIHdpdGggdGhlIGBCT01gXG5cdHZhciByZXBsYWNlTWFwID0ge1xuXHRcdCclRkUlRkYnOiAnXFx1RkZGRFxcdUZGRkQnLFxuXHRcdCclRkYlRkUnOiAnXFx1RkZGRFxcdUZGRkQnXG5cdH07XG5cblx0dmFyIG1hdGNoID0gbXVsdGlNYXRjaGVyLmV4ZWMoaW5wdXQpO1xuXHR3aGlsZSAobWF0Y2gpIHtcblx0XHR0cnkge1xuXHRcdFx0Ly8gRGVjb2RlIGFzIGJpZyBjaHVua3MgYXMgcG9zc2libGVcblx0XHRcdHJlcGxhY2VNYXBbbWF0Y2hbMF1dID0gZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoWzBdKTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdHZhciByZXN1bHQgPSBkZWNvZGUobWF0Y2hbMF0pO1xuXG5cdFx0XHRpZiAocmVzdWx0ICE9PSBtYXRjaFswXSkge1xuXHRcdFx0XHRyZXBsYWNlTWFwW21hdGNoWzBdXSA9IHJlc3VsdDtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRtYXRjaCA9IG11bHRpTWF0Y2hlci5leGVjKGlucHV0KTtcblx0fVxuXG5cdC8vIEFkZCBgJUMyYCBhdCB0aGUgZW5kIG9mIHRoZSBtYXAgdG8gbWFrZSBzdXJlIGl0IGRvZXMgbm90IHJlcGxhY2UgdGhlIGNvbWJpbmF0b3IgYmVmb3JlIGV2ZXJ5dGhpbmcgZWxzZVxuXHRyZXBsYWNlTWFwWyclQzInXSA9ICdcXHVGRkZEJztcblxuXHR2YXIgZW50cmllcyA9IE9iamVjdC5rZXlzKHJlcGxhY2VNYXApO1xuXG5cdGZvciAodmFyIGkgPSAwOyBpIDwgZW50cmllcy5sZW5ndGg7IGkrKykge1xuXHRcdC8vIFJlcGxhY2UgYWxsIGRlY29kZWQgY29tcG9uZW50c1xuXHRcdHZhciBrZXkgPSBlbnRyaWVzW2ldO1xuXHRcdGlucHV0ID0gaW5wdXQucmVwbGFjZShuZXcgUmVnRXhwKGtleSwgJ2cnKSwgcmVwbGFjZU1hcFtrZXldKTtcblx0fVxuXG5cdHJldHVybiBpbnB1dDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoZW5jb2RlZFVSSSkge1xuXHRpZiAodHlwZW9mIGVuY29kZWRVUkkgIT09ICdzdHJpbmcnKSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcignRXhwZWN0ZWQgYGVuY29kZWRVUklgIHRvIGJlIG9mIHR5cGUgYHN0cmluZ2AsIGdvdCBgJyArIHR5cGVvZiBlbmNvZGVkVVJJICsgJ2AnKTtcblx0fVxuXG5cdHRyeSB7XG5cdFx0ZW5jb2RlZFVSSSA9IGVuY29kZWRVUkkucmVwbGFjZSgvXFwrL2csICcgJyk7XG5cblx0XHQvLyBUcnkgdGhlIGJ1aWx0IGluIGRlY29kZXIgZmlyc3Rcblx0XHRyZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGVuY29kZWRVUkkpO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBGYWxsYmFjayB0byBhIG1vcmUgYWR2YW5jZWQgZGVjb2RlclxuXHRcdHJldHVybiBjdXN0b21EZWNvZGVVUklDb21wb25lbnQoZW5jb2RlZFVSSSk7XG5cdH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKHN0cmluZywgc2VwYXJhdG9yKSA9PiB7XG5cdGlmICghKHR5cGVvZiBzdHJpbmcgPT09ICdzdHJpbmcnICYmIHR5cGVvZiBzZXBhcmF0b3IgPT09ICdzdHJpbmcnKSkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ0V4cGVjdGVkIHRoZSBhcmd1bWVudHMgdG8gYmUgb2YgdHlwZSBgc3RyaW5nYCcpO1xuXHR9XG5cblx0aWYgKHNlcGFyYXRvciA9PT0gJycpIHtcblx0XHRyZXR1cm4gW3N0cmluZ107XG5cdH1cblxuXHRjb25zdCBzZXBhcmF0b3JJbmRleCA9IHN0cmluZy5pbmRleE9mKHNlcGFyYXRvcik7XG5cblx0aWYgKHNlcGFyYXRvckluZGV4ID09PSAtMSkge1xuXHRcdHJldHVybiBbc3RyaW5nXTtcblx0fVxuXG5cdHJldHVybiBbXG5cdFx0c3RyaW5nLnNsaWNlKDAsIHNlcGFyYXRvckluZGV4KSxcblx0XHRzdHJpbmcuc2xpY2Uoc2VwYXJhdG9ySW5kZXggKyBzZXBhcmF0b3IubGVuZ3RoKVxuXHRdO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbmNvbnN0IHN0cmljdFVyaUVuY29kZSA9IHJlcXVpcmUoJ3N0cmljdC11cmktZW5jb2RlJyk7XG5jb25zdCBkZWNvZGVDb21wb25lbnQgPSByZXF1aXJlKCdkZWNvZGUtdXJpLWNvbXBvbmVudCcpO1xuY29uc3Qgc3BsaXRPbkZpcnN0ID0gcmVxdWlyZSgnc3BsaXQtb24tZmlyc3QnKTtcblxuZnVuY3Rpb24gZW5jb2RlckZvckFycmF5Rm9ybWF0KG9wdGlvbnMpIHtcblx0c3dpdGNoIChvcHRpb25zLmFycmF5Rm9ybWF0KSB7XG5cdFx0Y2FzZSAnaW5kZXgnOlxuXHRcdFx0cmV0dXJuIGtleSA9PiAocmVzdWx0LCB2YWx1ZSkgPT4ge1xuXHRcdFx0XHRjb25zdCBpbmRleCA9IHJlc3VsdC5sZW5ndGg7XG5cdFx0XHRcdGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IChvcHRpb25zLnNraXBOdWxsICYmIHZhbHVlID09PSBudWxsKSkge1xuXHRcdFx0XHRcdHJldHVybiByZXN1bHQ7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAodmFsdWUgPT09IG51bGwpIHtcblx0XHRcdFx0XHRyZXR1cm4gWy4uLnJlc3VsdCwgW2VuY29kZShrZXksIG9wdGlvbnMpLCAnWycsIGluZGV4LCAnXSddLmpvaW4oJycpXTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiBbXG5cdFx0XHRcdFx0Li4ucmVzdWx0LFxuXHRcdFx0XHRcdFtlbmNvZGUoa2V5LCBvcHRpb25zKSwgJ1snLCBlbmNvZGUoaW5kZXgsIG9wdGlvbnMpLCAnXT0nLCBlbmNvZGUodmFsdWUsIG9wdGlvbnMpXS5qb2luKCcnKVxuXHRcdFx0XHRdO1xuXHRcdFx0fTtcblxuXHRcdGNhc2UgJ2JyYWNrZXQnOlxuXHRcdFx0cmV0dXJuIGtleSA9PiAocmVzdWx0LCB2YWx1ZSkgPT4ge1xuXHRcdFx0XHRpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCAob3B0aW9ucy5za2lwTnVsbCAmJiB2YWx1ZSA9PT0gbnVsbCkpIHtcblx0XHRcdFx0XHRyZXR1cm4gcmVzdWx0O1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHZhbHVlID09PSBudWxsKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFsuLi5yZXN1bHQsIFtlbmNvZGUoa2V5LCBvcHRpb25zKSwgJ1tdJ10uam9pbignJyldO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0cmV0dXJuIFsuLi5yZXN1bHQsIFtlbmNvZGUoa2V5LCBvcHRpb25zKSwgJ1tdPScsIGVuY29kZSh2YWx1ZSwgb3B0aW9ucyldLmpvaW4oJycpXTtcblx0XHRcdH07XG5cblx0XHRjYXNlICdjb21tYSc6XG5cdFx0Y2FzZSAnc2VwYXJhdG9yJzpcblx0XHRcdHJldHVybiBrZXkgPT4gKHJlc3VsdCwgdmFsdWUpID0+IHtcblx0XHRcdFx0aWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRcdFx0cmV0dXJuIHJlc3VsdDtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChyZXN1bHQubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFtbZW5jb2RlKGtleSwgb3B0aW9ucyksICc9JywgZW5jb2RlKHZhbHVlLCBvcHRpb25zKV0uam9pbignJyldO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0cmV0dXJuIFtbcmVzdWx0LCBlbmNvZGUodmFsdWUsIG9wdGlvbnMpXS5qb2luKG9wdGlvbnMuYXJyYXlGb3JtYXRTZXBhcmF0b3IpXTtcblx0XHRcdH07XG5cblx0XHRkZWZhdWx0OlxuXHRcdFx0cmV0dXJuIGtleSA9PiAocmVzdWx0LCB2YWx1ZSkgPT4ge1xuXHRcdFx0XHRpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCAob3B0aW9ucy5za2lwTnVsbCAmJiB2YWx1ZSA9PT0gbnVsbCkpIHtcblx0XHRcdFx0XHRyZXR1cm4gcmVzdWx0O1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHZhbHVlID09PSBudWxsKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFsuLi5yZXN1bHQsIGVuY29kZShrZXksIG9wdGlvbnMpXTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiBbLi4ucmVzdWx0LCBbZW5jb2RlKGtleSwgb3B0aW9ucyksICc9JywgZW5jb2RlKHZhbHVlLCBvcHRpb25zKV0uam9pbignJyldO1xuXHRcdFx0fTtcblx0fVxufVxuXG5mdW5jdGlvbiBwYXJzZXJGb3JBcnJheUZvcm1hdChvcHRpb25zKSB7XG5cdGxldCByZXN1bHQ7XG5cblx0c3dpdGNoIChvcHRpb25zLmFycmF5Rm9ybWF0KSB7XG5cdFx0Y2FzZSAnaW5kZXgnOlxuXHRcdFx0cmV0dXJuIChrZXksIHZhbHVlLCBhY2N1bXVsYXRvcikgPT4ge1xuXHRcdFx0XHRyZXN1bHQgPSAvXFxbKFxcZCopXFxdJC8uZXhlYyhrZXkpO1xuXG5cdFx0XHRcdGtleSA9IGtleS5yZXBsYWNlKC9cXFtcXGQqXFxdJC8sICcnKTtcblxuXHRcdFx0XHRpZiAoIXJlc3VsdCkge1xuXHRcdFx0XHRcdGFjY3VtdWxhdG9yW2tleV0gPSB2YWx1ZTtcblx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAoYWNjdW11bGF0b3Jba2V5XSA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRcdFx0YWNjdW11bGF0b3Jba2V5XSA9IHt9O1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0YWNjdW11bGF0b3Jba2V5XVtyZXN1bHRbMV1dID0gdmFsdWU7XG5cdFx0XHR9O1xuXG5cdFx0Y2FzZSAnYnJhY2tldCc6XG5cdFx0XHRyZXR1cm4gKGtleSwgdmFsdWUsIGFjY3VtdWxhdG9yKSA9PiB7XG5cdFx0XHRcdHJlc3VsdCA9IC8oXFxbXFxdKSQvLmV4ZWMoa2V5KTtcblx0XHRcdFx0a2V5ID0ga2V5LnJlcGxhY2UoL1xcW1xcXSQvLCAnJyk7XG5cblx0XHRcdFx0aWYgKCFyZXN1bHQpIHtcblx0XHRcdFx0XHRhY2N1bXVsYXRvcltrZXldID0gdmFsdWU7XG5cdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKGFjY3VtdWxhdG9yW2tleV0gPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0XHRcdGFjY3VtdWxhdG9yW2tleV0gPSBbdmFsdWVdO1xuXHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGFjY3VtdWxhdG9yW2tleV0gPSBbXS5jb25jYXQoYWNjdW11bGF0b3Jba2V5XSwgdmFsdWUpO1xuXHRcdFx0fTtcblxuXHRcdGNhc2UgJ2NvbW1hJzpcblx0XHRjYXNlICdzZXBhcmF0b3InOlxuXHRcdFx0cmV0dXJuIChrZXksIHZhbHVlLCBhY2N1bXVsYXRvcikgPT4ge1xuXHRcdFx0XHRjb25zdCBpc0FycmF5ID0gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiB2YWx1ZS5zcGxpdCgnJykuaW5kZXhPZihvcHRpb25zLmFycmF5Rm9ybWF0U2VwYXJhdG9yKSA+IC0xO1xuXHRcdFx0XHRjb25zdCBuZXdWYWx1ZSA9IGlzQXJyYXkgPyB2YWx1ZS5zcGxpdChvcHRpb25zLmFycmF5Rm9ybWF0U2VwYXJhdG9yKS5tYXAoaXRlbSA9PiBkZWNvZGUoaXRlbSwgb3B0aW9ucykpIDogdmFsdWUgPT09IG51bGwgPyB2YWx1ZSA6IGRlY29kZSh2YWx1ZSwgb3B0aW9ucyk7XG5cdFx0XHRcdGFjY3VtdWxhdG9yW2tleV0gPSBuZXdWYWx1ZTtcblx0XHRcdH07XG5cblx0XHRkZWZhdWx0OlxuXHRcdFx0cmV0dXJuIChrZXksIHZhbHVlLCBhY2N1bXVsYXRvcikgPT4ge1xuXHRcdFx0XHRpZiAoYWNjdW11bGF0b3Jba2V5XSA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRcdFx0YWNjdW11bGF0b3Jba2V5XSA9IHZhbHVlO1xuXHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGFjY3VtdWxhdG9yW2tleV0gPSBbXS5jb25jYXQoYWNjdW11bGF0b3Jba2V5XSwgdmFsdWUpO1xuXHRcdFx0fTtcblx0fVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUFycmF5Rm9ybWF0U2VwYXJhdG9yKHZhbHVlKSB7XG5cdGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnIHx8IHZhbHVlLmxlbmd0aCAhPT0gMSkge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ2FycmF5Rm9ybWF0U2VwYXJhdG9yIG11c3QgYmUgc2luZ2xlIGNoYXJhY3RlciBzdHJpbmcnKTtcblx0fVxufVxuXG5mdW5jdGlvbiBlbmNvZGUodmFsdWUsIG9wdGlvbnMpIHtcblx0aWYgKG9wdGlvbnMuZW5jb2RlKSB7XG5cdFx0cmV0dXJuIG9wdGlvbnMuc3RyaWN0ID8gc3RyaWN0VXJpRW5jb2RlKHZhbHVlKSA6IGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSk7XG5cdH1cblxuXHRyZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGRlY29kZSh2YWx1ZSwgb3B0aW9ucykge1xuXHRpZiAob3B0aW9ucy5kZWNvZGUpIHtcblx0XHRyZXR1cm4gZGVjb2RlQ29tcG9uZW50KHZhbHVlKTtcblx0fVxuXG5cdHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24ga2V5c1NvcnRlcihpbnB1dCkge1xuXHRpZiAoQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcblx0XHRyZXR1cm4gaW5wdXQuc29ydCgpO1xuXHR9XG5cblx0aWYgKHR5cGVvZiBpbnB1dCA9PT0gJ29iamVjdCcpIHtcblx0XHRyZXR1cm4ga2V5c1NvcnRlcihPYmplY3Qua2V5cyhpbnB1dCkpXG5cdFx0XHQuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEpIC0gTnVtYmVyKGIpKVxuXHRcdFx0Lm1hcChrZXkgPT4gaW5wdXRba2V5XSk7XG5cdH1cblxuXHRyZXR1cm4gaW5wdXQ7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUhhc2goaW5wdXQpIHtcblx0Y29uc3QgaGFzaFN0YXJ0ID0gaW5wdXQuaW5kZXhPZignIycpO1xuXHRpZiAoaGFzaFN0YXJ0ICE9PSAtMSkge1xuXHRcdGlucHV0ID0gaW5wdXQuc2xpY2UoMCwgaGFzaFN0YXJ0KTtcblx0fVxuXG5cdHJldHVybiBpbnB1dDtcbn1cblxuZnVuY3Rpb24gZ2V0SGFzaCh1cmwpIHtcblx0bGV0IGhhc2ggPSAnJztcblx0Y29uc3QgaGFzaFN0YXJ0ID0gdXJsLmluZGV4T2YoJyMnKTtcblx0aWYgKGhhc2hTdGFydCAhPT0gLTEpIHtcblx0XHRoYXNoID0gdXJsLnNsaWNlKGhhc2hTdGFydCk7XG5cdH1cblxuXHRyZXR1cm4gaGFzaDtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdChpbnB1dCkge1xuXHRpbnB1dCA9IHJlbW92ZUhhc2goaW5wdXQpO1xuXHRjb25zdCBxdWVyeVN0YXJ0ID0gaW5wdXQuaW5kZXhPZignPycpO1xuXHRpZiAocXVlcnlTdGFydCA9PT0gLTEpIHtcblx0XHRyZXR1cm4gJyc7XG5cdH1cblxuXHRyZXR1cm4gaW5wdXQuc2xpY2UocXVlcnlTdGFydCArIDEpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVZhbHVlKHZhbHVlLCBvcHRpb25zKSB7XG5cdGlmIChvcHRpb25zLnBhcnNlTnVtYmVycyAmJiAhTnVtYmVyLmlzTmFOKE51bWJlcih2YWx1ZSkpICYmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmIHZhbHVlLnRyaW0oKSAhPT0gJycpKSB7XG5cdFx0dmFsdWUgPSBOdW1iZXIodmFsdWUpO1xuXHR9IGVsc2UgaWYgKG9wdGlvbnMucGFyc2VCb29sZWFucyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAodmFsdWUudG9Mb3dlckNhc2UoKSA9PT0gJ3RydWUnIHx8IHZhbHVlLnRvTG93ZXJDYXNlKCkgPT09ICdmYWxzZScpKSB7XG5cdFx0dmFsdWUgPSB2YWx1ZS50b0xvd2VyQ2FzZSgpID09PSAndHJ1ZSc7XG5cdH1cblxuXHRyZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlKGlucHV0LCBvcHRpb25zKSB7XG5cdG9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHtcblx0XHRkZWNvZGU6IHRydWUsXG5cdFx0c29ydDogdHJ1ZSxcblx0XHRhcnJheUZvcm1hdDogJ25vbmUnLFxuXHRcdGFycmF5Rm9ybWF0U2VwYXJhdG9yOiAnLCcsXG5cdFx0cGFyc2VOdW1iZXJzOiBmYWxzZSxcblx0XHRwYXJzZUJvb2xlYW5zOiBmYWxzZVxuXHR9LCBvcHRpb25zKTtcblxuXHR2YWxpZGF0ZUFycmF5Rm9ybWF0U2VwYXJhdG9yKG9wdGlvbnMuYXJyYXlGb3JtYXRTZXBhcmF0b3IpO1xuXG5cdGNvbnN0IGZvcm1hdHRlciA9IHBhcnNlckZvckFycmF5Rm9ybWF0KG9wdGlvbnMpO1xuXG5cdC8vIENyZWF0ZSBhbiBvYmplY3Qgd2l0aCBubyBwcm90b3R5cGVcblx0Y29uc3QgcmV0ID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcblxuXHRpZiAodHlwZW9mIGlucHV0ICE9PSAnc3RyaW5nJykge1xuXHRcdHJldHVybiByZXQ7XG5cdH1cblxuXHRpbnB1dCA9IGlucHV0LnRyaW0oKS5yZXBsYWNlKC9eWz8jJl0vLCAnJyk7XG5cblx0aWYgKCFpbnB1dCkge1xuXHRcdHJldHVybiByZXQ7XG5cdH1cblxuXHRmb3IgKGNvbnN0IHBhcmFtIG9mIGlucHV0LnNwbGl0KCcmJykpIHtcblx0XHRsZXQgW2tleSwgdmFsdWVdID0gc3BsaXRPbkZpcnN0KG9wdGlvbnMuZGVjb2RlID8gcGFyYW0ucmVwbGFjZSgvXFwrL2csICcgJykgOiBwYXJhbSwgJz0nKTtcblxuXHRcdC8vIE1pc3NpbmcgYD1gIHNob3VsZCBiZSBgbnVsbGA6XG5cdFx0Ly8gaHR0cDovL3czLm9yZy9UUi8yMDEyL1dELXVybC0yMDEyMDUyNC8jY29sbGVjdC11cmwtcGFyYW1ldGVyc1xuXHRcdHZhbHVlID0gdmFsdWUgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBvcHRpb25zLmFycmF5Rm9ybWF0ID09PSAnY29tbWEnID8gdmFsdWUgOiBkZWNvZGUodmFsdWUsIG9wdGlvbnMpO1xuXHRcdGZvcm1hdHRlcihkZWNvZGUoa2V5LCBvcHRpb25zKSwgdmFsdWUsIHJldCk7XG5cdH1cblxuXHRmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhyZXQpKSB7XG5cdFx0Y29uc3QgdmFsdWUgPSByZXRba2V5XTtcblx0XHRpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuXHRcdFx0Zm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKHZhbHVlKSkge1xuXHRcdFx0XHR2YWx1ZVtrXSA9IHBhcnNlVmFsdWUodmFsdWVba10sIG9wdGlvbnMpO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXRba2V5XSA9IHBhcnNlVmFsdWUodmFsdWUsIG9wdGlvbnMpO1xuXHRcdH1cblx0fVxuXG5cdGlmIChvcHRpb25zLnNvcnQgPT09IGZhbHNlKSB7XG5cdFx0cmV0dXJuIHJldDtcblx0fVxuXG5cdHJldHVybiAob3B0aW9ucy5zb3J0ID09PSB0cnVlID8gT2JqZWN0LmtleXMocmV0KS5zb3J0KCkgOiBPYmplY3Qua2V5cyhyZXQpLnNvcnQob3B0aW9ucy5zb3J0KSkucmVkdWNlKChyZXN1bHQsIGtleSkgPT4ge1xuXHRcdGNvbnN0IHZhbHVlID0gcmV0W2tleV07XG5cdFx0aWYgKEJvb2xlYW4odmFsdWUpICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG5cdFx0XHQvLyBTb3J0IG9iamVjdCBrZXlzLCBub3QgdmFsdWVzXG5cdFx0XHRyZXN1bHRba2V5XSA9IGtleXNTb3J0ZXIodmFsdWUpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXN1bHRba2V5XSA9IHZhbHVlO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXN1bHQ7XG5cdH0sIE9iamVjdC5jcmVhdGUobnVsbCkpO1xufVxuXG5leHBvcnRzLmV4dHJhY3QgPSBleHRyYWN0O1xuZXhwb3J0cy5wYXJzZSA9IHBhcnNlO1xuXG5leHBvcnRzLnN0cmluZ2lmeSA9IChvYmplY3QsIG9wdGlvbnMpID0+IHtcblx0aWYgKCFvYmplY3QpIHtcblx0XHRyZXR1cm4gJyc7XG5cdH1cblxuXHRvcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG5cdFx0ZW5jb2RlOiB0cnVlLFxuXHRcdHN0cmljdDogdHJ1ZSxcblx0XHRhcnJheUZvcm1hdDogJ25vbmUnLFxuXHRcdGFycmF5Rm9ybWF0U2VwYXJhdG9yOiAnLCdcblx0fSwgb3B0aW9ucyk7XG5cblx0dmFsaWRhdGVBcnJheUZvcm1hdFNlcGFyYXRvcihvcHRpb25zLmFycmF5Rm9ybWF0U2VwYXJhdG9yKTtcblxuXHRjb25zdCBmb3JtYXR0ZXIgPSBlbmNvZGVyRm9yQXJyYXlGb3JtYXQob3B0aW9ucyk7XG5cblx0Y29uc3Qgb2JqZWN0Q29weSA9IE9iamVjdC5hc3NpZ24oe30sIG9iamVjdCk7XG5cdGlmIChvcHRpb25zLnNraXBOdWxsKSB7XG5cdFx0Zm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMob2JqZWN0Q29weSkpIHtcblx0XHRcdGlmIChvYmplY3RDb3B5W2tleV0gPT09IHVuZGVmaW5lZCB8fCBvYmplY3RDb3B5W2tleV0gPT09IG51bGwpIHtcblx0XHRcdFx0ZGVsZXRlIG9iamVjdENvcHlba2V5XTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRjb25zdCBrZXlzID0gT2JqZWN0LmtleXMob2JqZWN0Q29weSk7XG5cblx0aWYgKG9wdGlvbnMuc29ydCAhPT0gZmFsc2UpIHtcblx0XHRrZXlzLnNvcnQob3B0aW9ucy5zb3J0KTtcblx0fVxuXG5cdHJldHVybiBrZXlzLm1hcChrZXkgPT4ge1xuXHRcdGNvbnN0IHZhbHVlID0gb2JqZWN0W2tleV07XG5cblx0XHRpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuXHRcdFx0cmV0dXJuICcnO1xuXHRcdH1cblxuXHRcdGlmICh2YWx1ZSA9PT0gbnVsbCkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShrZXksIG9wdGlvbnMpO1xuXHRcdH1cblxuXHRcdGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuXHRcdFx0cmV0dXJuIHZhbHVlXG5cdFx0XHRcdC5yZWR1Y2UoZm9ybWF0dGVyKGtleSksIFtdKVxuXHRcdFx0XHQuam9pbignJicpO1xuXHRcdH1cblxuXHRcdHJldHVybiBlbmNvZGUoa2V5LCBvcHRpb25zKSArICc9JyArIGVuY29kZSh2YWx1ZSwgb3B0aW9ucyk7XG5cdH0pLmZpbHRlcih4ID0+IHgubGVuZ3RoID4gMCkuam9pbignJicpO1xufTtcblxuZXhwb3J0cy5wYXJzZVVybCA9IChpbnB1dCwgb3B0aW9ucykgPT4ge1xuXHRyZXR1cm4ge1xuXHRcdHVybDogcmVtb3ZlSGFzaChpbnB1dCkuc3BsaXQoJz8nKVswXSB8fCAnJyxcblx0XHRxdWVyeTogcGFyc2UoZXh0cmFjdChpbnB1dCksIG9wdGlvbnMpXG5cdH07XG59O1xuXG5leHBvcnRzLnN0cmluZ2lmeVVybCA9IChpbnB1dCwgb3B0aW9ucykgPT4ge1xuXHRjb25zdCB1cmwgPSByZW1vdmVIYXNoKGlucHV0LnVybCkuc3BsaXQoJz8nKVswXSB8fCAnJztcblx0Y29uc3QgcXVlcnlGcm9tVXJsID0gZXhwb3J0cy5leHRyYWN0KGlucHV0LnVybCk7XG5cdGNvbnN0IHBhcnNlZFF1ZXJ5RnJvbVVybCA9IGV4cG9ydHMucGFyc2UocXVlcnlGcm9tVXJsKTtcblx0Y29uc3QgaGFzaCA9IGdldEhhc2goaW5wdXQudXJsKTtcblx0Y29uc3QgcXVlcnkgPSBPYmplY3QuYXNzaWduKHBhcnNlZFF1ZXJ5RnJvbVVybCwgaW5wdXQucXVlcnkpO1xuXHRsZXQgcXVlcnlTdHJpbmcgPSBleHBvcnRzLnN0cmluZ2lmeShxdWVyeSwgb3B0aW9ucyk7XG5cdGlmIChxdWVyeVN0cmluZykge1xuXHRcdHF1ZXJ5U3RyaW5nID0gYD8ke3F1ZXJ5U3RyaW5nfWA7XG5cdH1cblxuXHRyZXR1cm4gYCR7dXJsfSR7cXVlcnlTdHJpbmd9JHtoYXNofWA7XG59O1xuIiwiaW1wb3J0IFJvdXRlciBmcm9tICdhYnN0cmFjdC1uZXN0ZWQtcm91dGVyJztcbmltcG9ydCB7IHdyaXRhYmxlIH0gZnJvbSAnc3ZlbHRlL3N0b3JlJztcbmltcG9ydCBxdWVyeVN0cmluZyBmcm9tICdxdWVyeS1zdHJpbmcnO1xuXG5jb25zdCBjYWNoZSA9IHt9O1xuY29uc3QgYmFzZVRhZyA9IGRvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdiYXNlJyk7XG5jb25zdCBiYXNlUHJlZml4ID0gKGJhc2VUYWdbMF0gJiYgYmFzZVRhZ1swXS5ocmVmLnJlcGxhY2UoL1xcLyQvLCAnJykpIHx8ICcvJztcblxuZXhwb3J0IGNvbnN0IFJPT1RfVVJMID0gYmFzZVByZWZpeC5yZXBsYWNlKHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4sICcnKTtcblxuZXhwb3J0IGNvbnN0IHJvdXRlciA9IHdyaXRhYmxlKHtcbiAgcGF0aDogJy8nLFxuICBxdWVyeToge30sXG4gIHBhcmFtczoge30sXG59KTtcblxuZXhwb3J0IGNvbnN0IENUWF9ST1VURVIgPSB7fTtcbmV4cG9ydCBjb25zdCBDVFhfUk9VVEUgPSB7fTtcblxuLy8gdXNlIGxvY2F0aW9uLmhhc2ggb24gZW1iZWRkZWQgcGFnZXMsIGUuZy4gU3ZlbHRlIFJFUExcbmV4cG9ydCBsZXQgSEFTSENIQU5HRSA9IHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4gPT09ICdudWxsJztcblxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hjaGFuZ2VFbmFibGUodmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgSEFTSENIQU5HRSA9ICEhdmFsdWU7XG4gIH1cblxuICByZXR1cm4gSEFTSENIQU5HRTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpeGVkTG9jYXRpb24ocGF0aCwgY2FsbGJhY2ssIGRvRmluYWxseSkge1xuICBjb25zdCBiYXNlVXJpID0gaGFzaGNoYW5nZUVuYWJsZSgpID8gd2luZG93LmxvY2F0aW9uLmhhc2gucmVwbGFjZSgnIycsICcnKSA6IHdpbmRvdy5sb2NhdGlvbi5wYXRobmFtZTtcblxuICAvLyB0aGlzIHdpbGwgcmViYXNlIGFuY2hvcnMgdG8gYXZvaWQgbG9jYXRpb24gY2hhbmdlc1xuICBpZiAocGF0aC5jaGFyQXQoKSAhPT0gJy8nKSB7XG4gICAgcGF0aCA9IGJhc2VVcmkgKyBwYXRoO1xuICB9XG5cbiAgY29uc3QgY3VycmVudFVSTCA9IGJhc2VVcmkgKyB3aW5kb3cubG9jYXRpb24uaGFzaCArIHdpbmRvdy5sb2NhdGlvbi5zZWFyY2g7XG5cbiAgLy8gZG8gbm90IGNoYW5nZSBsb2NhdGlvbiBldCBhbGwuLi5cbiAgaWYgKGN1cnJlbnRVUkwgIT09IHBhdGgpIHtcbiAgICBjYWxsYmFjayhwYXRoKTtcbiAgfVxuXG4gIC8vIGludm9rZSBmaW5hbCBndWFyZCByZWdhcmRsZXNzIG9mIHByZXZpb3VzIHJlc3VsdFxuICBpZiAodHlwZW9mIGRvRmluYWxseSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGRvRmluYWxseSgpO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBuYXZpZ2F0ZVRvKHBhdGgsIG9wdGlvbnMpIHtcbiAgY29uc3Qge1xuICAgIHJlbG9hZCwgcmVwbGFjZSxcbiAgICBwYXJhbXMsIHF1ZXJ5UGFyYW1zLFxuICB9ID0gb3B0aW9ucyB8fCB7fTtcblxuICAvLyBJZiBwYXRoIGVtcHR5IG9yIG5vIHN0cmluZywgdGhyb3dzIGVycm9yXG4gIGlmICghcGF0aCB8fCB0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycgfHwgKHBhdGhbMF0gIT09ICcvJyAmJiBwYXRoWzBdICE9PSAnIycpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RpbmcgJy8ke3BhdGh9JyBvciAnIyR7cGF0aH0nLCBnaXZlbiAnJHtwYXRofSdgKTtcbiAgfVxuXG4gIGlmIChwYXJhbXMpIHtcbiAgICBwYXRoID0gcGF0aC5yZXBsYWNlKC86KFthLXpBLVpdW2EtekEtWjAtOV8tXSopL2csIChfLCBrZXkpID0+IHBhcmFtc1trZXldKTtcbiAgfVxuXG4gIC8vIHJlYmFzZSBhY3RpdmUgVVJMXG4gIGlmIChST09UX1VSTCAhPT0gJy8nICYmIHBhdGguaW5kZXhPZihST09UX1VSTCkgIT09IDApIHtcbiAgICBwYXRoID0gUk9PVF9VUkwgKyBwYXRoO1xuICB9XG5cbiAgaWYgKHF1ZXJ5UGFyYW1zKSB7XG4gICAgY29uc3QgcXMgPSBxdWVyeVN0cmluZy5zdHJpbmdpZnkocXVlcnlQYXJhbXMpO1xuXG4gICAgaWYgKHFzKSB7XG4gICAgICBwYXRoICs9IGA/JHtxc31gO1xuICAgIH1cbiAgfVxuXG4gIGlmIChoYXNoY2hhbmdlRW5hYmxlKCkpIHtcbiAgICB3aW5kb3cubG9jYXRpb24uaGFzaCA9IHBhdGgucmVwbGFjZSgvXiMvLCAnJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gSWYgbm8gSGlzdG9yeSBBUEkgc3VwcG9ydCwgZmFsbGJhY2tzIHRvIFVSTCByZWRpcmVjdFxuICBpZiAocmVsb2FkIHx8ICF3aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUgfHwgIXdpbmRvdy5kaXNwYXRjaEV2ZW50KSB7XG4gICAgd2luZG93LmxvY2F0aW9uLmhyZWYgPSBwYXRoO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIElmIGhhcyBIaXN0b3J5IEFQSSBzdXBwb3J0LCB1c2VzIGl0XG4gIGZpeGVkTG9jYXRpb24ocGF0aCwgbmV4dFVSTCA9PiB7XG4gICAgd2luZG93Lmhpc3RvcnlbcmVwbGFjZSA/ICdyZXBsYWNlU3RhdGUnIDogJ3B1c2hTdGF0ZSddKG51bGwsICcnLCBuZXh0VVJMKTtcbiAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ3BvcHN0YXRlJykpO1xuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFByb3BzKGdpdmVuLCByZXF1aXJlZCkge1xuICBjb25zdCB7IHByb3BzOiBzdWIsIC4uLm90aGVycyB9ID0gZ2l2ZW47XG5cbiAgLy8gcHJ1bmUgYWxsIGRlY2xhcmVkIHByb3BzIGZyb20gdGhpcyBjb21wb25lbnRcbiAgcmVxdWlyZWQuZm9yRWFjaChrID0+IHtcbiAgICBkZWxldGUgb3RoZXJzW2tdO1xuICB9KTtcblxuICByZXR1cm4ge1xuICAgIC4uLnN1YixcbiAgICAuLi5vdGhlcnMsXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0FjdGl2ZSh1cmksIHBhdGgsIGV4YWN0KSB7XG4gIGlmICghY2FjaGVbW3VyaSwgcGF0aCwgZXhhY3RdXSkge1xuICAgIGlmIChleGFjdCAhPT0gdHJ1ZSAmJiBwYXRoLmluZGV4T2YodXJpKSA9PT0gMCkge1xuICAgICAgY2FjaGVbW3VyaSwgcGF0aCwgZXhhY3RdXSA9IC9eWyMvP10/JC8udGVzdChwYXRoLnN1YnN0cih1cmkubGVuZ3RoLCAxKSk7XG4gICAgfSBlbHNlIGlmICh1cmkuaW5jbHVkZXMoJyonKSB8fCB1cmkuaW5jbHVkZXMoJzonKSkge1xuICAgICAgY2FjaGVbW3VyaSwgcGF0aCwgZXhhY3RdXSA9IFJvdXRlci5tYXRjaGVzKHVyaSwgcGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhY2hlW1t1cmksIHBhdGgsIGV4YWN0XV0gPSBwYXRoID09PSB1cmk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNhY2hlW1t1cmksIHBhdGgsIGV4YWN0XV07XG59XG4iLCJpbXBvcnQgcXVlcnlTdHJpbmcgZnJvbSAncXVlcnktc3RyaW5nJztcbmltcG9ydCBSb3V0ZXIgZnJvbSAnYWJzdHJhY3QtbmVzdGVkLXJvdXRlcic7XG5pbXBvcnQgeyB3cml0YWJsZSB9IGZyb20gJ3N2ZWx0ZS9zdG9yZSc7XG5cbmltcG9ydCB7XG4gIFJPT1RfVVJMLCBoYXNoY2hhbmdlRW5hYmxlLCBuYXZpZ2F0ZVRvLCBpc0FjdGl2ZSwgcm91dGVyLFxufSBmcm9tICcuL3V0aWxzJztcblxuZXhwb3J0IGNvbnN0IGJhc2VSb3V0ZXIgPSBuZXcgUm91dGVyKCk7XG5leHBvcnQgY29uc3Qgcm91dGVJbmZvID0gd3JpdGFibGUoe30pO1xuXG4vLyBwcml2YXRlIHJlZ2lzdHJpZXNcbmNvbnN0IG9uRXJyb3IgPSB7fTtcbmNvbnN0IHNoYXJlZCA9IHt9O1xuXG5sZXQgZXJyb3JzID0gW107XG5sZXQgcm91dGVycyA9IDA7XG5sZXQgaW50ZXJ2YWw7XG5cbi8vIHRha2Ugc25hcHNob3QgZnJvbSBjdXJyZW50IHN0YXRlLi4uXG5yb3V0ZXIuc3Vic2NyaWJlKHZhbHVlID0+IHsgc2hhcmVkLnJvdXRlciA9IHZhbHVlOyB9KTtcbnJvdXRlSW5mby5zdWJzY3JpYmUodmFsdWUgPT4geyBzaGFyZWQucm91dGVJbmZvID0gdmFsdWU7IH0pO1xuXG5leHBvcnQgZnVuY3Rpb24gZG9GYWxsYmFjayhmYWlsdXJlLCBmYWxsYmFjaykge1xuICByb3V0ZUluZm8udXBkYXRlKGRlZmF1bHRzID0+ICh7XG4gICAgLi4uZGVmYXVsdHMsXG4gICAgW2ZhbGxiYWNrXToge1xuICAgICAgLi4uc2hhcmVkLnJvdXRlcixcbiAgICAgIGZhaWx1cmUsXG4gICAgfSxcbiAgfSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFuZGxlUm91dGVzKG1hcCwgcGFyYW1zKSB7XG4gIGNvbnN0IGtleXMgPSBbXTtcblxuICBtYXAuc29tZSh4ID0+IHtcbiAgICBpZiAoeC5rZXkgJiYgeC5tYXRjaGVzICYmICF4LmZhbGxiYWNrICYmICFzaGFyZWQucm91dGVJbmZvW3gua2V5XSkge1xuICAgICAgaWYgKHgucmVkaXJlY3QgJiYgKHguY29uZGl0aW9uID09PSBudWxsIHx8IHguY29uZGl0aW9uKHNoYXJlZC5yb3V0ZXIpICE9PSB0cnVlKSkge1xuICAgICAgICBpZiAoeC5leGFjdCAmJiBzaGFyZWQucm91dGVyLnBhdGggIT09IHgucGF0aCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBuYXZpZ2F0ZVRvKHgucmVkaXJlY3QpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKHguZXhhY3QpIHtcbiAgICAgICAga2V5cy5wdXNoKHgua2V5KTtcbiAgICAgIH1cblxuICAgICAgLy8gZXh0ZW5kIHNoYXJlZCBwYXJhbXMuLi5cbiAgICAgIE9iamVjdC5hc3NpZ24ocGFyYW1zLCB4LnBhcmFtcyk7XG5cbiAgICAgIC8vIHVwZ3JhZGUgbWF0Y2hpbmcgcm91dGVzIVxuICAgICAgcm91dGVJbmZvLnVwZGF0ZShkZWZhdWx0cyA9PiAoe1xuICAgICAgICAuLi5kZWZhdWx0cyxcbiAgICAgICAgW3gua2V5XToge1xuICAgICAgICAgIC4uLnNoYXJlZC5yb3V0ZXIsXG4gICAgICAgICAgLi4ueCxcbiAgICAgICAgfSxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH0pO1xuXG4gIHJldHVybiBrZXlzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXZ0SGFuZGxlcigpIHtcbiAgbGV0IGJhc2VVcmkgPSAhaGFzaGNoYW5nZUVuYWJsZSgpID8gd2luZG93LmxvY2F0aW9uLmhyZWYucmVwbGFjZSh3aW5kb3cubG9jYXRpb24ub3JpZ2luLCAnJykgOiB3aW5kb3cubG9jYXRpb24uaGFzaCB8fCAnLyc7XG4gIGxldCBmYWlsdXJlO1xuXG4gIC8vIHVucHJlZml4IGFjdGl2ZSBVUkxcbiAgaWYgKFJPT1RfVVJMICE9PSAnLycpIHtcbiAgICBiYXNlVXJpID0gYmFzZVVyaS5yZXBsYWNlKFJPT1RfVVJMLCAnJyk7XG4gIH1cblxuICBjb25zdCBbZnVsbHBhdGgsIHFzXSA9IGJhc2VVcmkucmVwbGFjZSgnLyMnLCAnIycpLnJlcGxhY2UoL14jXFwvLywgJy8nKS5zcGxpdCgnPycpO1xuICBjb25zdCBxdWVyeSA9IHF1ZXJ5U3RyaW5nLnBhcnNlKHFzKTtcbiAgY29uc3QgcGFyYW1zID0ge307XG4gIGNvbnN0IGtleXMgPSBbXTtcblxuICAvLyByZXNldCBjdXJyZW50IHN0YXRlXG4gIHJvdXRlSW5mby5zZXQoe30pO1xuICByb3V0ZXIuc2V0KHtcbiAgICBxdWVyeSxcbiAgICBwYXJhbXMsXG4gICAgcGF0aDogZnVsbHBhdGgsXG4gIH0pO1xuXG4gIC8vIGxvYWQgYWxsIG1hdGNoaW5nIHJvdXRlcy4uLlxuICBiYXNlUm91dGVyLnJlc29sdmUoZnVsbHBhdGgsIChlcnIsIHJlc3VsdCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIGZhaWx1cmUgPSBlcnI7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gc2F2ZSBleGFjdC1rZXlzIGZvciBkZWxldGlvbiBhZnRlciBmYWlsdXJlcyFcbiAgICBrZXlzLnB1c2goLi4uaGFuZGxlUm91dGVzKHJlc3VsdCwgcGFyYW1zKSk7XG4gIH0pO1xuXG4gIGNvbnN0IHRvRGVsZXRlID0ge307XG5cbiAgaWYgKGZhaWx1cmUpIHtcbiAgICBrZXlzLnJlZHVjZSgocHJldiwgY3VyKSA9PiB7XG4gICAgICBwcmV2W2N1cl0gPSBudWxsO1xuICAgICAgcmV0dXJuIHByZXY7XG4gICAgfSwgdG9EZWxldGUpO1xuICB9XG5cbiAgLy8gY2xlYXIgcHJldmlvdXNseSBmYWlsZWQgaGFuZGxlcnNcbiAgZXJyb3JzLmZvckVhY2goY2IgPT4gY2IoKSk7XG4gIGVycm9ycyA9IFtdO1xuXG4gIHRyeSB7XG4gICAgLy8gY2xlYXIgcm91dGVzIHRoYXQgbm90IGxvbmdlciBtYXRjaGVzIVxuICAgIGJhc2VSb3V0ZXIuZmluZChmdWxscGF0aCkuZm9yRWFjaChzdWIgPT4ge1xuICAgICAgaWYgKHN1Yi5leGFjdCAmJiAhc3ViLm1hdGNoZXMpIHtcbiAgICAgICAgdG9EZWxldGVbc3ViLmtleV0gPSBudWxsO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gdGhpcyBpcyBmaW5lXG4gIH1cblxuICAvLyBkcm9wIHVud2FudGVkIHJvdXRlcy4uLlxuICByb3V0ZUluZm8udXBkYXRlKGRlZmF1bHRzID0+ICh7XG4gICAgLi4uZGVmYXVsdHMsXG4gICAgLi4udG9EZWxldGUsXG4gIH0pKTtcblxuICBsZXQgZmFsbGJhY2s7XG5cbiAgLy8gaW52b2tlIGVycm9yLWhhbmRsZXJzIHRvIGNsZWFyIG91dCBwcmV2aW91cyBzdGF0ZSFcbiAgT2JqZWN0LmtleXMob25FcnJvcikuZm9yRWFjaChyb290ID0+IHtcbiAgICBpZiAoaXNBY3RpdmUocm9vdCwgZnVsbHBhdGgsIGZhbHNlKSkge1xuICAgICAgY29uc3QgZm4gPSBvbkVycm9yW3Jvb3RdLmNhbGxiYWNrO1xuXG4gICAgICBmbihmYWlsdXJlKTtcbiAgICAgIGVycm9ycy5wdXNoKGZuKTtcbiAgICB9XG5cbiAgICBpZiAoIWZhbGxiYWNrICYmIG9uRXJyb3Jbcm9vdF0uZmFsbGJhY2spIHtcbiAgICAgIGZhbGxiYWNrID0gb25FcnJvcltyb290XS5mYWxsYmFjaztcbiAgICB9XG4gIH0pO1xuXG4gIC8vIGhhbmRsZSB1bm1hdGNoZWQgZmFsbGJhY2tzXG4gIGlmIChmYWlsdXJlICYmIGZhbGxiYWNrKSB7XG4gICAgZG9GYWxsYmFjayhmYWlsdXJlLCBmYWxsYmFjayk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRSb3V0ZXMoKSB7XG4gIGNsZWFyVGltZW91dChpbnRlcnZhbCk7XG4gIGludGVydmFsID0gc2V0VGltZW91dChldnRIYW5kbGVyKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZFJvdXRlcihyb290LCBmYWxsYmFjaywgY2FsbGJhY2spIHtcbiAgaWYgKCFyb3V0ZXJzKSB7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3BvcHN0YXRlJywgZmluZFJvdXRlcywgZmFsc2UpO1xuICB9XG5cbiAgLy8gcmVnaXN0ZXIgZXJyb3ItaGFuZGxlcnNcbiAgb25FcnJvcltyb290XSA9IHsgZmFsbGJhY2ssIGNhbGxiYWNrIH07XG4gIHJvdXRlcnMgKz0gMTtcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGRlbGV0ZSBvbkVycm9yW3Jvb3RdO1xuICAgIHJvdXRlcnMgLT0gMTtcblxuICAgIGlmICghcm91dGVycykge1xuICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3BvcHN0YXRlJywgZmluZFJvdXRlcywgZmFsc2UpO1xuICAgIH1cbiAgfTtcbn1cbiIsIjxzY3JpcHQgY29udGV4dD1cIm1vZHVsZVwiPlxuICBpbXBvcnQgeyB3cml0YWJsZSB9IGZyb20gJ3N2ZWx0ZS9zdG9yZSc7XG4gIGltcG9ydCB7IENUWF9ST1VURVIsIHJvdXRlciB9IGZyb20gJy4vdXRpbHMnO1xuICBpbXBvcnQge1xuICAgIGJhc2VSb3V0ZXIsIGFkZFJvdXRlciwgZmluZFJvdXRlcywgZG9GYWxsYmFjayxcbiAgfSBmcm9tICcuL3JvdXRlcic7XG48L3NjcmlwdD5cblxuPHNjcmlwdD5cbiAgaW1wb3J0IHtcbiAgICBvbk1vdW50LCBvbkRlc3Ryb3ksIGdldENvbnRleHQsIHNldENvbnRleHQsXG4gIH0gZnJvbSAnc3ZlbHRlJztcblxuICBsZXQgY2xlYW51cDtcbiAgbGV0IGZhaWx1cmU7XG4gIGxldCBmYWxsYmFjaztcblxuICBleHBvcnQgbGV0IHBhdGggPSAnLyc7XG4gIGV4cG9ydCBsZXQgZGlzYWJsZWQgPSBmYWxzZTtcbiAgZXhwb3J0IGxldCBjb25kaXRpb24gPSBudWxsO1xuICBleHBvcnQgbGV0IG5vZmFsbGJhY2sgPSBmYWxzZTtcblxuICBjb25zdCByb3V0ZXJDb250ZXh0ID0gZ2V0Q29udGV4dChDVFhfUk9VVEVSKTtcbiAgY29uc3QgYmFzZVBhdGggPSByb3V0ZXJDb250ZXh0ID8gcm91dGVyQ29udGV4dC5iYXNlUGF0aCA6IHdyaXRhYmxlKHBhdGgpO1xuXG4gIGNvbnN0IGZpeGVkUm9vdCA9ICRiYXNlUGF0aCAhPT0gcGF0aCAmJiAkYmFzZVBhdGggIT09ICcvJ1xuICAgID8gYCR7JGJhc2VQYXRofSR7cGF0aCAhPT0gJy8nID8gcGF0aCA6ICcnfWBcbiAgICA6IHBhdGg7XG5cbiAgdHJ5IHtcbiAgICBpZiAoY29uZGl0aW9uICE9PSBudWxsICYmIHR5cGVvZiBjb25kaXRpb24gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGluZyBjb25kaXRpb24gdG8gYmUgYSBmdW5jdGlvbiwgZ2l2ZW4gJyR7Y29uZGl0aW9ufSdgKTtcbiAgICB9XG5cbiAgICBpZiAocGF0aC5jaGFyQXQoKSAhPT0gJyMnICYmIHBhdGguY2hhckF0KCkgIT09ICcvJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0aW5nIGEgbGVhZGluZyBzbGFzaCBvciBoYXNoLCBnaXZlbiAnJHtwYXRofSdgKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBmYWlsdXJlID0gZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGFzc2lnblJvdXRlKGtleSwgcm91dGUsIGRldGFpbCkge1xuICAgIGtleSA9IGtleSB8fCBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMik7XG5cbiAgICAvLyBjb25zaWRlciBhcyBuZXN0ZWQgcm91dGVzIGlmIHRoZXkgZG9lcyBub3QgaGF2ZSBhbnkgc2VnbWVudFxuICAgIGNvbnN0IG5lc3RlZCA9ICFyb3V0ZS5zdWJzdHIoMSkuaW5jbHVkZXMoJy8nKTtcbiAgICBjb25zdCBoYW5kbGVyID0geyBrZXksIG5lc3RlZCwgLi4uZGV0YWlsIH07XG5cbiAgICBsZXQgZnVsbHBhdGg7XG5cbiAgICBiYXNlUm91dGVyLm1vdW50KGZpeGVkUm9vdCwgKCkgPT4ge1xuICAgICAgZnVsbHBhdGggPSBiYXNlUm91dGVyLmFkZChyb3V0ZSwgaGFuZGxlcik7XG4gICAgICBmYWxsYmFjayA9IChoYW5kbGVyLmZhbGxiYWNrICYmIGtleSkgfHwgZmFsbGJhY2s7XG4gICAgfSk7XG5cbiAgICBmaW5kUm91dGVzKCk7XG5cbiAgICByZXR1cm4gW2tleSwgZnVsbHBhdGhdO1xuICB9XG5cbiAgZnVuY3Rpb24gdW5hc3NpZ25Sb3V0ZShyb3V0ZSkge1xuICAgIGJhc2VSb3V0ZXIucm0ocm91dGUpO1xuICAgIGZpbmRSb3V0ZXMoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uRXJyb3IoZXJyKSB7XG4gICAgZmFpbHVyZSA9IGVycjtcblxuICAgIGlmIChmYWlsdXJlICYmIGZhbGxiYWNrKSB7XG4gICAgICBkb0ZhbGxiYWNrKGZhaWx1cmUsIGZhbGxiYWNrKTtcbiAgICB9XG4gIH1cblxuICBvbk1vdW50KCgpID0+IHtcbiAgICBjbGVhbnVwID0gYWRkUm91dGVyKGZpeGVkUm9vdCwgZmFsbGJhY2ssIG9uRXJyb3IpO1xuICB9KTtcblxuICBvbkRlc3Ryb3koKCkgPT4ge1xuICAgIGlmIChjbGVhbnVwKSBjbGVhbnVwKCk7XG4gIH0pO1xuXG4gIHNldENvbnRleHQoQ1RYX1JPVVRFUiwge1xuICAgIGJhc2VQYXRoLFxuICAgIGFzc2lnblJvdXRlLFxuICAgIHVuYXNzaWduUm91dGUsXG4gIH0pO1xuXG4gICQ6IGlmIChjb25kaXRpb24pIHtcbiAgICBkaXNhYmxlZCA9ICFjb25kaXRpb24oJHJvdXRlcik7XG4gIH1cbjwvc2NyaXB0PlxuXG48c3R5bGU+XG4gIFtkYXRhLWZhaWx1cmVdIHtcbiAgICBib3JkZXI6IDFweCBkYXNoZWQgc2lsdmVyO1xuICB9XG48L3N0eWxlPlxuXG57I2lmICFkaXNhYmxlZH1cbiAgPHNsb3QgLz5cbnsvaWZ9XG5cbnsjaWYgZmFpbHVyZSAmJiAhZmFsbGJhY2sgJiYgIW5vZmFsbGJhY2t9XG4gIDxmaWVsZHNldCBkYXRhLWZhaWx1cmU+XG4gICAgPGxlZ2VuZD5Sb3V0ZXIgZmFpbHVyZToge3BhdGh9PC9sZWdlbmQ+XG4gICAgPHByZT57ZmFpbHVyZX08L3ByZT5cbiAgPC9maWVsZHNldD5cbnsvaWZ9XG4iLCI8c2NyaXB0IGNvbnRleHQ9XCJtb2R1bGVcIj5cbiAgaW1wb3J0IHsgd3JpdGFibGUgfSBmcm9tICdzdmVsdGUvc3RvcmUnO1xuICBpbXBvcnQgeyByb3V0ZUluZm8gfSBmcm9tICcuL3JvdXRlcic7XG4gIGltcG9ydCB7IENUWF9ST1VURVIsIENUWF9ST1VURSwgZ2V0UHJvcHMgfSBmcm9tICcuL3V0aWxzJztcbjwvc2NyaXB0PlxuXG48c2NyaXB0PlxuICBpbXBvcnQgeyBvbkRlc3Ryb3ksIGdldENvbnRleHQsIHNldENvbnRleHQgfSBmcm9tICdzdmVsdGUnO1xuXG4gIGV4cG9ydCBsZXQga2V5ID0gbnVsbDtcbiAgZXhwb3J0IGxldCBwYXRoID0gJy8nO1xuICBleHBvcnQgbGV0IGV4YWN0ID0gbnVsbDtcbiAgZXhwb3J0IGxldCBkeW5hbWljID0gbnVsbDtcbiAgZXhwb3J0IGxldCBwZW5kaW5nID0gbnVsbDtcbiAgZXhwb3J0IGxldCBkaXNhYmxlZCA9IGZhbHNlO1xuICBleHBvcnQgbGV0IGZhbGxiYWNrID0gbnVsbDtcbiAgZXhwb3J0IGxldCBjb21wb25lbnQgPSBudWxsO1xuICBleHBvcnQgbGV0IGNvbmRpdGlvbiA9IG51bGw7XG4gIGV4cG9ydCBsZXQgcmVkaXJlY3QgPSBudWxsO1xuXG4gIC8vIHJlcGxhY2VtZW50IGZvciBgT2JqZWN0LmtleXMoYXJndW1lbnRzWzBdLiQkLnByb3BzKWBcbiAgY29uc3QgdGhpc1Byb3BzID0gWydrZXknLCAncGF0aCcsICdleGFjdCcsICdkeW5hbWljJywgJ3BlbmRpbmcnLCAnZGlzYWJsZWQnLCAnZmFsbGJhY2snLCAnY29tcG9uZW50JywgJ2NvbmRpdGlvbicsICdyZWRpcmVjdCddO1xuXG4gIGNvbnN0IHJvdXRlQ29udGV4dCA9IGdldENvbnRleHQoQ1RYX1JPVVRFKTtcbiAgY29uc3Qgcm91dGVyQ29udGV4dCA9IGdldENvbnRleHQoQ1RYX1JPVVRFUik7XG5cbiAgY29uc3QgeyBhc3NpZ25Sb3V0ZSwgdW5hc3NpZ25Sb3V0ZSB9ID0gcm91dGVyQ29udGV4dCB8fCB7fTtcblxuICBjb25zdCByb3V0ZVBhdGggPSByb3V0ZUNvbnRleHQgPyByb3V0ZUNvbnRleHQucm91dGVQYXRoIDogd3JpdGFibGUocGF0aCk7XG5cbiAgbGV0IGFjdGl2ZVJvdXRlciA9IG51bGw7XG4gIGxldCBhY3RpdmVQcm9wcyA9IHt9O1xuICBsZXQgZnVsbHBhdGg7XG4gIGxldCBmYWlsdXJlO1xuXG4gIGNvbnN0IGZpeGVkUm9vdCA9ICRyb3V0ZVBhdGggIT09IHBhdGggJiYgJHJvdXRlUGF0aCAhPT0gJy8nXG4gICAgPyBgJHskcm91dGVQYXRofSR7cGF0aCAhPT0gJy8nID8gcGF0aCA6ICcnfWBcbiAgICA6IHBhdGg7XG5cbiAgdHJ5IHtcbiAgICBpZiAocmVkaXJlY3QgIT09IG51bGwgJiYgIS9eKD86XFx3KzpcXC9cXC98XFwvKS8udGVzdChyZWRpcmVjdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGluZyB2YWxpZCBVUkwgdG8gcmVkaXJlY3QsIGdpdmVuICcke3JlZGlyZWN0fSdgKTtcbiAgICB9XG5cbiAgICBpZiAoY29uZGl0aW9uICE9PSBudWxsICYmIHR5cGVvZiBjb25kaXRpb24gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGluZyBjb25kaXRpb24gdG8gYmUgYSBmdW5jdGlvbiwgZ2l2ZW4gJyR7Y29uZGl0aW9ufSdgKTtcbiAgICB9XG5cbiAgICBpZiAocGF0aC5jaGFyQXQoKSAhPT0gJyMnICYmIHBhdGguY2hhckF0KCkgIT09ICcvJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0aW5nIGEgbGVhZGluZyBzbGFzaCBvciBoYXNoLCBnaXZlbiAnJHtwYXRofSdgKTtcbiAgICB9XG5cbiAgICBpZiAoIWFzc2lnblJvdXRlKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBNaXNzaW5nIHRvcC1sZXZlbCA8Um91dGVyPiwgZ2l2ZW4gcm91dGU6ICR7cGF0aH1gKTtcbiAgICB9XG5cbiAgICBba2V5LCBmdWxscGF0aF0gPSBhc3NpZ25Sb3V0ZShrZXksIGZpeGVkUm9vdCwge1xuICAgICAgY29uZGl0aW9uLCByZWRpcmVjdCwgZmFsbGJhY2ssIGV4YWN0LFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgZmFpbHVyZSA9IGU7XG4gIH1cblxuICAkOiBpZiAoa2V5KSB7XG4gICAgYWN0aXZlUm91dGVyID0gIWRpc2FibGVkICYmICRyb3V0ZUluZm9ba2V5XTtcbiAgICBhY3RpdmVQcm9wcyA9IGdldFByb3BzKCQkcHJvcHMsIHRoaXNQcm9wcyk7XG4gIH1cblxuICBvbkRlc3Ryb3koKCkgPT4ge1xuICAgIGlmICh1bmFzc2lnblJvdXRlKSB7XG4gICAgICB1bmFzc2lnblJvdXRlKGZ1bGxwYXRoKTtcbiAgICB9XG4gIH0pO1xuXG4gIHNldENvbnRleHQoQ1RYX1JPVVRFLCB7XG4gICAgcm91dGVQYXRoLFxuICB9KTtcbjwvc2NyaXB0PlxuXG48c3R5bGU+XG4gIFtkYXRhLWZhaWx1cmVdIHtcbiAgICBjb2xvcjogcmVkO1xuICB9XG48L3N0eWxlPlxuXG57I2lmIGZhaWx1cmV9XG4gIDxwIGRhdGEtZmFpbHVyZT57ZmFpbHVyZX08L3A+XG57L2lmfVxuXG57I2lmIGFjdGl2ZVJvdXRlcn1cbiAgeyNpZiBkeW5hbWljfVxuICAgIHsjYXdhaXQgZHluYW1pY31cbiAgICAgIHsjaWYgcGVuZGluZ317cGVuZGluZ317L2lmfVxuICAgIHs6dGhlbiBjfVxuICAgICAgPHN2ZWx0ZTpjb21wb25lbnQgdGhpcz17Yy5kZWZhdWx0fSByb3V0ZXI9e2FjdGl2ZVJvdXRlcn0gey4uLmFjdGl2ZVByb3BzfSAvPlxuICAgIHsvYXdhaXR9XG4gIHs6ZWxzZX1cbiAgICB7I2lmIGNvbXBvbmVudH1cbiAgICAgIDxzdmVsdGU6Y29tcG9uZW50IHRoaXM9e2NvbXBvbmVudH0gcm91dGVyPXthY3RpdmVSb3V0ZXJ9IHsuLi5hY3RpdmVQcm9wc30gLz5cbiAgICB7OmVsc2V9XG4gICAgICA8c2xvdCByb3V0ZXI9e2FjdGl2ZVJvdXRlcn0gcHJvcHM9e2FjdGl2ZVByb3BzfSAvPlxuICAgIHsvaWZ9XG4gIHsvaWZ9XG57L2lmfVxuIiwiPHNjcmlwdD5cbiAgaW1wb3J0IHsgY3JlYXRlRXZlbnREaXNwYXRjaGVyIH0gZnJvbSAnc3ZlbHRlJztcblxuICBpbXBvcnQge1xuICAgIFJPT1RfVVJMLCBmaXhlZExvY2F0aW9uLCBuYXZpZ2F0ZVRvLCBpc0FjdGl2ZSwgZ2V0UHJvcHMsIHJvdXRlcixcbiAgfSBmcm9tICcuL3V0aWxzJztcblxuICBsZXQgcmVmO1xuICBsZXQgYWN0aXZlO1xuICBsZXQgY3NzQ2xhc3MgPSAnJztcbiAgbGV0IGZpeGVkSHJlZiA9IG51bGw7XG5cbiAgZXhwb3J0IGxldCBnbyA9IG51bGw7XG4gIGV4cG9ydCBsZXQgb3BlbiA9IG51bGw7XG4gIGV4cG9ydCBsZXQgaHJlZiA9ICcvJztcbiAgZXhwb3J0IGxldCB0aXRsZSA9ICcnO1xuICBleHBvcnQgbGV0IGJ1dHRvbiA9IGZhbHNlO1xuICBleHBvcnQgbGV0IGV4YWN0ID0gZmFsc2U7XG4gIGV4cG9ydCBsZXQgcmVsb2FkID0gZmFsc2U7XG4gIGV4cG9ydCBsZXQgcmVwbGFjZSA9IGZhbHNlO1xuICBleHBvcnQgeyBjc3NDbGFzcyBhcyBjbGFzcyB9O1xuXG4gIC8vIHJlcGxhY2VtZW50IGZvciBgT2JqZWN0LmtleXMoYXJndW1lbnRzWzBdLiQkLnByb3BzKWBcbiAgY29uc3QgdGhpc1Byb3BzID0gWydnbycsICdvcGVuJywgJ2hyZWYnLCAnY2xhc3MnLCAndGl0bGUnLCAnYnV0dG9uJywgJ2V4YWN0JywgJ3JlbG9hZCcsICdyZXBsYWNlJ107XG5cbiAgLy8gcmViYXNlIGFjdGl2ZSBVUkxcbiAgJDogaWYgKCEvXihcXHcrOik/XFwvXFwvLy50ZXN0KGhyZWYpKSB7XG4gICAgZml4ZWRIcmVmID0gUk9PVF9VUkwgKyBocmVmO1xuICB9XG5cbiAgJDogaWYgKHJlZiAmJiAkcm91dGVyLnBhdGgpIHtcbiAgICBpZiAoaXNBY3RpdmUoaHJlZiwgJHJvdXRlci5wYXRoLCBleGFjdCkpIHtcbiAgICAgIGlmICghYWN0aXZlKSB7XG4gICAgICAgIGFjdGl2ZSA9IHRydWU7XG4gICAgICAgIHJlZi5zZXRBdHRyaWJ1dGUoJ2FyaWEtY3VycmVudCcsICdwYWdlJyk7XG5cbiAgICAgICAgaWYgKGJ1dHRvbikge1xuICAgICAgICAgIHJlZi5zZXRBdHRyaWJ1dGUoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdGl2ZSkge1xuICAgICAgYWN0aXZlID0gZmFsc2U7XG4gICAgICByZWYucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgcmVmLnJlbW92ZUF0dHJpYnV0ZSgnYXJpYS1jdXJyZW50Jyk7XG4gICAgfVxuICB9XG5cbiAgLy8gZXh0cmFjdCBhZGRpdGlvbmFsIHByb3BzXG4gICQ6IGZpeGVkUHJvcHMgPSBnZXRQcm9wcygkJHByb3BzLCB0aGlzUHJvcHMpO1xuXG4gIGNvbnN0IGRpc3BhdGNoID0gY3JlYXRlRXZlbnREaXNwYXRjaGVyKCk7XG5cbiAgLy8gdGhpcyB3aWxsIGVuYWJsZSBgPExpbmsgb246Y2xpY2s9ey4uLn0gLz5gIGNhbGxzXG4gIGZ1bmN0aW9uIG9uQ2xpY2soZSkge1xuICAgIGlmICh0eXBlb2YgZ28gPT09ICdzdHJpbmcnICYmIHdpbmRvdy5oaXN0b3J5Lmxlbmd0aCA+IDEpIHtcbiAgICAgIGlmIChnbyA9PT0gJ2JhY2snKSB3aW5kb3cuaGlzdG9yeS5iYWNrKCk7XG4gICAgICBlbHNlIGlmIChnbyA9PT0gJ2Z3ZCcpIHdpbmRvdy5oaXN0b3J5LmZvcndhcmQoKTtcbiAgICAgIGVsc2Ugd2luZG93Lmhpc3RvcnkuZ28ocGFyc2VJbnQoZ28sIDEwKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFmaXhlZEhyZWYpIHtcbiAgICAgIGlmIChvcGVuKSB7XG4gICAgICAgIGxldCBzcGVjcyA9IHR5cGVvZiBvcGVuID09PSAnc3RyaW5nJyA/IG9wZW4gOiAnJztcblxuICAgICAgICBjb25zdCB3bWF0Y2ggPSBzcGVjcy5tYXRjaCgvd2lkdGg9KFxcZCspLyk7XG4gICAgICAgIGNvbnN0IGhtYXRjaCA9IHNwZWNzLm1hdGNoKC9oZWlnaHQ9KFxcZCspLyk7XG5cbiAgICAgICAgaWYgKHdtYXRjaCkgc3BlY3MgKz0gYCxsZWZ0PSR7KHdpbmRvdy5zY3JlZW4ud2lkdGggLSB3bWF0Y2hbMV0pIC8gMn1gO1xuICAgICAgICBpZiAoaG1hdGNoKSBzcGVjcyArPSBgLHRvcD0keyh3aW5kb3cuc2NyZWVuLmhlaWdodCAtIGhtYXRjaFsxXSkgLyAyfWA7XG5cbiAgICAgICAgaWYgKHdtYXRjaCAmJiAhaG1hdGNoKSB7XG4gICAgICAgICAgc3BlY3MgKz0gYCxoZWlnaHQ9JHt3bWF0Y2hbMV19LHRvcD0keyh3aW5kb3cuc2NyZWVuLmhlaWdodCAtIHdtYXRjaFsxXSkgLyAyfWA7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB3ID0gd2luZG93Lm9wZW4oaHJlZiwgJycsIHNwZWNzKTtcbiAgICAgICAgY29uc3QgdCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICBpZiAody5jbG9zZWQpIHtcbiAgICAgICAgICAgIGRpc3BhdGNoKCdjbG9zZScpO1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sIDEyMCk7XG4gICAgICB9IGVsc2Ugd2luZG93LmxvY2F0aW9uLmhyZWYgPSBocmVmO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZpeGVkTG9jYXRpb24oaHJlZiwgbmV4dFVSTCA9PiB7XG4gICAgICBuYXZpZ2F0ZVRvKG5leHRVUkwsIHsgcmVsb2FkLCByZXBsYWNlIH0pO1xuICAgIH0sICgpID0+IGRpc3BhdGNoKCdjbGljaycsIGUpKTtcbiAgfVxuPC9zY3JpcHQ+XG5cbnsjaWYgYnV0dG9ufVxuICA8YnV0dG9uIHsuLi5maXhlZFByb3BzfSBiaW5kOnRoaXM9e3JlZn0gY2xhc3M9e2Nzc0NsYXNzfSB7dGl0bGV9IG9uOmNsaWNrfHByZXZlbnREZWZhdWx0PXtvbkNsaWNrfT5cbiAgICA8c2xvdCAvPlxuICA8L2J1dHRvbj5cbns6ZWxzZX1cbiAgPGEgey4uLmZpeGVkUHJvcHN9IGhyZWY9e2ZpeGVkSHJlZiB8fCBocmVmfSBiaW5kOnRoaXM9e3JlZn0gY2xhc3M9e2Nzc0NsYXNzfSB7dGl0bGV9IG9uOmNsaWNrfHByZXZlbnREZWZhdWx0PXtvbkNsaWNrfT5cbiAgICA8c2xvdCAvPlxuICA8L2E+XG57L2lmfVxuIiwiaW1wb3J0IFJvdXRlciBmcm9tICcuL1JvdXRlci5zdmVsdGUnO1xuaW1wb3J0IFJvdXRlIGZyb20gJy4vUm91dGUuc3ZlbHRlJztcbmltcG9ydCBMaW5rIGZyb20gJy4vTGluay5zdmVsdGUnO1xuXG5pbXBvcnQgeyBoYXNoY2hhbmdlRW5hYmxlLCBuYXZpZ2F0ZVRvLCByb3V0ZXIgfSBmcm9tICcuL3V0aWxzJztcblxuT2JqZWN0LmRlZmluZVByb3BlcnR5KFJvdXRlciwgJ2hhc2hjaGFuZ2UnLCB7XG4gIHNldDogdmFsdWUgPT4gaGFzaGNoYW5nZUVuYWJsZSh2YWx1ZSksXG4gIGdldDogKCkgPT4gaGFzaGNoYW5nZUVuYWJsZSgpLFxuICBjb25maWd1cmFibGU6IGZhbHNlLFxuICBlbnVtZXJhYmxlOiBmYWxzZSxcbn0pO1xuXG5leHBvcnQge1xuICBSb3V0ZXIsXG4gIFJvdXRlLFxuICBMaW5rLFxuICByb3V0ZXIsXG4gIG5hdmlnYXRlVG8sXG59O1xuIiwiPHNjcmlwdD5cbiAgaW1wb3J0IHsgUm91dGVyLCBSb3V0ZSwgTGluayB9IGZyb20gJ3lydic7XG5cbiAgaW1wb3J0IE5vdEZvdW5kIGZyb20gJy4vcGFnZXMvTm90Rm91bmQuc3ZlbHRlJztcbiAgaW1wb3J0IEhvbWUgZnJvbSAnLi9wYWdlcy9Ib21lLnN2ZWx0ZSc7XG48L3NjcmlwdD5cblxuPFJvdXRlciBwYXRoPVwiL2FkbWluXCI+XG4gIDxuYXY+XG4gICAgPG5hdj5cbiAgICAgIDxMaW5rIGV4YWN0IGhyZWY9XCIvYWRtaW4vXCI+RGFzaGJvYXJkPC9MaW5rPlxuICAgICAgfCA8TGluayBleGFjdCBocmVmPVwiL2FkbWluL25vdC1mb3VuZFwiPlBhZ2Ugbm90IGZvdW5kPC9MaW5rPlxuICAgIDwvbmF2PlxuICA8L25hdj5cbiAgPG1haW4+XG4gICAgPFJvdXRlIGV4YWN0IHBhdGg9XCIvXCIgY29tcG9uZW50PXtIb21lfSAvPlxuICAgIDxSb3V0ZSBmYWxsYmFjayBjb21wb25lbnQ9e05vdEZvdW5kfSAvPlxuICA8L21haW4+XG48L1JvdXRlcj5cbiIsImltcG9ydCBBcHAgZnJvbSAnLi9jb21wb25lbnRzL0FwcC5zdmVsdGUnO1xuXG5uZXcgQXBwKHsgLy8gZXNsaW50LWRpc2FibGUtbGluZVxuICB0YXJnZXQ6IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNhcHAnKSxcbn0pO1xuXG4vLyBuYW1lPXhcbi8vIF9yZXBseXRvPXhcbi8vIF9zdWJqZWN0PXhcbi8vIF9jYz14LHkselxuXG4vLyAkLmFqYXgoe1xuLy8gICB1cmw6IFwiaHR0cHM6Ly9mb3Jtc3ByZWUuaW8veGRvd3J2anJcIixcbi8vICAgbWV0aG9kOiBcIlBPU1RcIixcbi8vICAgZGF0YToge21lc3NhZ2U6IFwiaGVsbG8hXCJ9LFxuLy8gICBkYXRhVHlwZTogXCJqc29uXCJcbi8vIH0pO1xuIl0sIm5hbWVzIjpbImRlY29kZUNvbXBvbmVudCIsIlJvdXRlciJdLCJtYXBwaW5ncyI6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S0FBSyxFQUFFO0NBQzNCLFVBQVUsSUFBSSxTQUFTLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzFEO0NBQ0EsVUFBVSxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUM7QUFDL0I7Q0FDQSxVQUFVLElBQUksU0FBUyxDQUFDLEtBQUssRUFBRTtDQUMvQixZQUFZLFFBQVEsR0FBRyxLQUFLLEtBQUssSUFBSSxDQUFDO0NBQ3RDLFdBQVcsTUFBTTtDQUNqQixZQUFZLFFBQVEsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDakYsV0FBVztBQUNYO0NBQ0EsVUFBVSxTQUFTLENBQUMsT0FBTyxHQUFHLFFBQVEsQ0FBQztDQUN2QyxVQUFVLFNBQVMsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7Q0FDdkQsVUFBVSxTQUFTLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7Q0FDMUMsVUFBVSxTQUFTLENBQUMsSUFBSSxHQUFHLFFBQVEsSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQztDQUMxRCxVQUFVLEdBQUcsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7Q0FDOUIsU0FBUztBQUNUO0NBQ0EsUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFO0NBQzdDLFVBQVUsT0FBTyxJQUFJLENBQUM7Q0FDdEIsU0FBUztBQUNUO0NBQ0EsUUFBUSxJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7Q0FDekMsUUFBUSxLQUFLLEdBQUcs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Q0Q7Q0FDTyxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFO0NBQzFDLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUM7QUFDMUM7Q0FDQTtDQUNBLEVBQUUsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUk7Q0FDeEIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUNyQixHQUFHLENBQUMsQ0FBQztBQUNMO0NBQ0EsRUFBRSxPQUFPO0NBQ1QsSUFBSSxHQUFHLEdBQUc7Q0FDVixJQUFJLEdBQUcsTUFBTTtDQUNiLEdBQUcsQ0FBQztDQUNKLENBQUM7QUFDRDtDQUNPLFNBQVMsUUFBUSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO0NBQzNDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsRUFBRTtDQUNsQyxJQUFJLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRTtDQUNuRCxNQUFNLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQzlFLEtBQUssTUFBTSxJQUFJLEdBQUcsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRTtDQUN2RCxNQUFNLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQztDQUM1RCxLQUFLLE1BQU07Q0FDWCxNQUFNLEtB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