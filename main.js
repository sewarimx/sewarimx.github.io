(function () {

	function noop() {}

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

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function children(element) {
		return Array.from(element.childNodes);
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
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

	var cart = writable({
	  items: [],
	  status: 'idle',
	});

	var skip;

	cart.subscribe(function (data) {
	  if (!skip && data.status !== 'idle') {
	    window.localStorage.cart$ = JSON.stringify(data);
	  }
	});

	if (window.localStorage.cart$) {
	  skip = true;
	  cart.update(function () { return (Object.assign({}, JSON.parse(window.localStorage.cart$),
	    {status: 'loaded'})); });
	  skip = false;
	}

	/* src/app/components/Cart.svelte generated by Svelte v3.3.0 */

	function add_css() {
		var style = element("style");
		style.id = 'svelte-yc08h3-style';
		style.textContent = ".notify.svelte-yc08h3{color:#95721C;padding:15px;background-color:#FFEA9F;position:fixed;top:120px;right:-100%;transition:all .3s}.removed.svelte-yc08h3,.updated.svelte-yc08h3,.added.svelte-yc08h3{right:0}";
		append(document.head, style);
	}

	function create_fragment(ctx) {
		var span0, t0, t1_value = ctx.$cart.status, t1, span0_class_value, t2, span1, t3_value = ctx.count || '-', t3, dispose;

		return {
			c() {
				span0 = element("span");
				t0 = text("An item was ");
				t1 = text(t1_value);
				t2 = space();
				span1 = element("span");
				t3 = text(t3_value);
				span0.className = span0_class_value = "notify " + ctx.$cart.status + " svelte-yc08h3";
				span1.className = "counter";
				dispose = listen(window, "click", ctx.add);
			},

			m(target, anchor) {
				insert(target, span0, anchor);
				append(span0, t0);
				append(span0, t1);
				add_binding_callback(() => ctx.span0_binding(span0, null));
				insert(target, t2, anchor);
				insert(target, span1, anchor);
				append(span1, t3);
			},

			p(changed, ctx) {
				if ((changed.$cart) && t1_value !== (t1_value = ctx.$cart.status)) {
					set_data(t1, t1_value);
				}

				if (changed.items) {
					ctx.span0_binding(null, span0);
					ctx.span0_binding(span0, null);
				}

				if ((changed.$cart) && span0_class_value !== (span0_class_value = "notify " + ctx.$cart.status + " svelte-yc08h3")) {
					span0.className = span0_class_value;
				}

				if ((changed.count) && t3_value !== (t3_value = ctx.count || '-')) {
					set_data(t3, t3_value);
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(span0);
				}

				ctx.span0_binding(null, span0);

				if (detaching) {
					detach(t2);
					detach(span1);
				}

				dispose();
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		let $cart;

		subscribe($$self, cart, $$value => { $cart = $$value; $$invalidate('$cart', $cart); });

		let ref;
	  let count;
	  let interval;

	  window.cartSync = data => cart.set(data);

	  function add(e) {
	    if (e.target.tagName === 'BUTTON' && e.target.dataset.buy) {
	      const currentItem = $cart.items.find(x => x.key === e.target.dataset.buy);

	      if (currentItem) {
	        currentItem.count += 1;
	      } else {
	        $cart.items.push({
	          key: e.target.dataset.buy,
	          count: 1,
	        });
	      }

	      $cart.status = 'added'; cart.set($cart);
	    }
	  }

		function span0_binding($$node, check) {
			ref = $$node;
			$$invalidate('ref', ref);
		}

		$$self.$$.update = ($$dirty = { $cart: 1, interval: 1 }) => {
			if ($$dirty.$cart || $$dirty.interval) { if ($cart.status !== 'idle') {
	        clearTimeout(interval);
	        $$invalidate('interval', interval = setTimeout(() => {
	          $cart.status = 'idle'; cart.set($cart);
	        }, 3000));
	      } }
			if ($$dirty.$cart) { $$invalidate('count', count = $cart.items.reduce((count, item) => count + item.count, 0)); }
		};

		return { ref, count, add, $cart, span0_binding };
	}

	class Cart extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-yc08h3-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, []);
		}
	}

	new Cart({ // eslint-disable-line
	  target: document.querySelector('#cart'),
	});

}());
