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

	function destroy_each(iterations, detaching) {
		for (let i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detaching);
		}
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

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function to_number(value) {
		return value === '' ? undefined : +value;
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

	function add_flush_callback(fn) {
		flush_callbacks.push(fn);
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

	function bind(component, name, callback) {
		if (component.$$.props.indexOf(name) === -1) return;
		component.$$.bound[name] = callback;
		callback(component.$$.ctx[name]);
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

	function formatMoney(value) {
	  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

	/* src/app/components/Number.svelte generated by Svelte v3.3.0 */

	function add_css() {
		var style = element("style");
		style.id = 'svelte-d6l8pb-style';
		style.textContent = "span.svelte-d6l8pb{display:flex}input.svelte-d6l8pb{width:60px !important;text-align:center;position:relative;z-index:2}button.svelte-d6l8pb{position:relative;z-index:1}";
		append(document.head, style);
	}

	function create_fragment(ctx) {
		var span, button0, t0, button0_disabled_value, t1, input, t2, button1, dispose;

		return {
			c() {
				span = element("span");
				button0 = element("button");
				t0 = text("-");
				t1 = space();
				input = element("input");
				t2 = space();
				button1 = element("button");
				button1.textContent = "+";
				button0.disabled = button0_disabled_value =  ctx.value === ctx.minimum;
				button0.className = "nosl svelte-d6l8pb";
				attr(input, "type", "number");
				input.min = ctx.minimum;
				input.className = "svelte-d6l8pb";
				button1.className = "nosl svelte-d6l8pb";
				span.className = "svelte-d6l8pb";

				dispose = [
					listen(button0, "click", ctx.dec),
					listen(input, "input", ctx.input_input_handler),
					listen(input, "change", ctx.sync),
					listen(button1, "click", ctx.inc)
				];
			},

			m(target, anchor) {
				insert(target, span, anchor);
				append(span, button0);
				append(button0, t0);
				append(span, t1);
				append(span, input);

				input.value = ctx.value;

				add_binding_callback(() => ctx.input_binding(input, null));
				append(span, t2);
				append(span, button1);
			},

			p(changed, ctx) {
				if ((changed.value || changed.minimum) && button0_disabled_value !== (button0_disabled_value =  ctx.value === ctx.minimum)) {
					button0.disabled = button0_disabled_value;
				}

				if (changed.value) input.value = ctx.value;
				if (changed.items) {
					ctx.input_binding(null, input);
					ctx.input_binding(input, null);
				}

				if (changed.minimum) {
					input.min = ctx.minimum;
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(span);
				}

				ctx.input_binding(null, input);
				run_all(dispose);
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		let { minimum = 1, value = 0 } = $$props;

	  const dispatch = createEventDispatcher();
	  let ref;

	  function sync() {
	    dispatch('change', ref);
	  }

	  function inc() {
	    ref.value = parseFloat(ref.value) + 1; $$invalidate('ref', ref);
	    sync();
	  }

	  function dec() {
	    ref.value = parseFloat(ref.value) - 1; $$invalidate('ref', ref);
	    sync();
	  }

		function input_input_handler() {
			value = to_number(this.value);
			$$invalidate('value', value), $$invalidate('minimum', minimum), $$invalidate('ref', ref);
		}

		function input_binding($$node, check) {
			ref = $$node;
			$$invalidate('ref', ref);
		}

		$$self.$set = $$props => {
			if ('minimum' in $$props) $$invalidate('minimum', minimum = $$props.minimum);
			if ('value' in $$props) $$invalidate('value', value = $$props.value);
		};

		$$self.$$.update = ($$dirty = { value: 1, minimum: 1, ref: 1 }) => {
			if ($$dirty.value || $$dirty.minimum || $$dirty.ref) { if (value !== minimum) {
	        $$invalidate('value', value = Math.max(parseFloat(ref.value), minimum));
	      } }
		};

		return {
			minimum,
			value,
			ref,
			sync,
			inc,
			dec,
			input_input_handler,
			input_binding
		};
	}

	class Number extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-d6l8pb-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, ["minimum", "value"]);
		}
	}

	/* src/app/components/Product.svelte generated by Svelte v3.3.0 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.price = list[i];
		return child_ctx;
	}

	// (50:8) {#if count > 1}
	function create_if_block(ctx) {
		var small, t0, t1, t2, t3_value = formatMoney(ctx.price.value * ctx.count), t3, t4;

		return {
			c() {
				small = element("small");
				t0 = text("×");
				t1 = text(ctx.count);
				t2 = text(" → $");
				t3 = text(t3_value);
				t4 = text(" MXN");
			},

			m(target, anchor) {
				insert(target, small, anchor);
				append(small, t0);
				append(small, t1);
				append(small, t2);
				append(small, t3);
				append(small, t4);
			},

			p(changed, ctx) {
				if (changed.count) {
					set_data(t1, ctx.count);
				}

				if ((changed.count) && t3_value !== (t3_value = formatMoney(ctx.price.value * ctx.count))) {
					set_data(t3, t3_value);
				}
			},

			d(detaching) {
				if (detaching) {
					detach(small);
				}
			}
		};
	}

	// (45:2) {#each product.prices as price}
	function create_each_block(ctx) {
		var li, label, input, input_value_value, t0, t1_value = ctx.price.label, t1, t2_value = ctx.price.required ? `* ${ctx.price.required}pz` : '', t2, t3, t4_value = formatMoney(ctx.price.value), t4, t5, t6_value = ctx.price.required ? '/cu' : '', t6, t7, dispose;

		var if_block = (ctx.count > 1) && create_if_block(ctx);

		return {
			c() {
				li = element("li");
				label = element("label");
				input = element("input");
				t0 = space();
				t1 = text(t1_value);
				t2 = text(t2_value);
				t3 = text(" — $");
				t4 = text(t4_value);
				t5 = text(" MXN ");
				t6 = text(t6_value);
				t7 = space();
				if (if_block) if_block.c();
				ctx.$$binding_groups[0].push(input);
				attr(input, "type", "radio");
				input.name = "price";
				input.__value = input_value_value = ctx.price.label;
				input.value = input.__value;

				dispose = [
					listen(input, "change", ctx.input_change_handler),
					listen(input, "change", ctx.set)
				];
			},

			m(target, anchor) {
				insert(target, li, anchor);
				append(li, label);
				append(label, input);

				input.checked = input.__value === ctx.active;

				append(label, t0);
				append(label, t1);
				append(label, t2);
				append(label, t3);
				append(label, t4);
				append(label, t5);
				append(label, t6);
				append(label, t7);
				if (if_block) if_block.m(label, null);
			},

			p(changed, ctx) {
				if (changed.active) input.checked = input.__value === ctx.active;
				input.value = input.__value;

				if (ctx.count > 1) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block(ctx);
						if_block.c();
						if_block.m(label, null);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}

				ctx.$$binding_groups[0].splice(ctx.$$binding_groups[0].indexOf(input), 1);
				if (if_block) if_block.d();
				run_all(dispose);
			}
		};
	}

	function create_fragment$1(ctx) {
		var h3, t1, ul, t2, div, updating_value, t3, button, t4, button_disabled_value, current, dispose;

		var each_value = ctx.product.prices;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		function num_value_binding(value) {
			ctx.num_value_binding.call(null, value);
			updating_value = true;
			add_flush_callback(() => updating_value = false);
		}

		let num_props = { minimum: (ctx.selected && ctx.selected.required) || 1 };
		if (ctx.count !== void 0) {
			num_props.value = ctx.count;
		}
		var num = new Number({ props: num_props });

		add_binding_callback(() => bind(num, 'value', num_value_binding));
		num.$on("change", ctx.change_handler);

		return {
			c() {
				h3 = element("h3");
				h3.textContent = "Presentación";
				t1 = space();
				ul = element("ul");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t2 = space();
				div = element("div");
				num.$$.fragment.c();
				t3 = space();
				button = element("button");
				t4 = text("COMPRAR");
				ul.className = "reset";
				button.disabled = button_disabled_value = !ctx.selected || !ctx.isValid;
				button.className = "nosl solid-shadow";
				div.className = "flex space";
				dispose = listen(button, "click", ctx.add);
			},

			m(target, anchor) {
				insert(target, h3, anchor);
				insert(target, t1, anchor);
				insert(target, ul, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(ul, null);
				}

				insert(target, t2, anchor);
				insert(target, div, anchor);
				mount_component(num, div, null);
				append(div, t3);
				append(div, button);
				append(button, t4);
				current = true;
			},

			p(changed, ctx) {
				if (changed.count || changed.formatMoney || changed.product || changed.active || changed.set) {
					each_value = ctx.product.prices;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(ul, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				var num_changes = {};
				if (changed.selected) num_changes.minimum = (ctx.selected && ctx.selected.required) || 1;
				if (!updating_value && changed.count) {
					num_changes.value = ctx.count;
				}
				num.$set(num_changes);

				if ((!current || changed.selected || changed.isValid) && button_disabled_value !== (button_disabled_value = !ctx.selected || !ctx.isValid)) {
					button.disabled = button_disabled_value;
				}
			},

			i(local) {
				if (current) return;
				num.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				num.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(h3);
					detach(t1);
					detach(ul);
				}

				destroy_each(each_blocks, detaching);

				if (detaching) {
					detach(t2);
					detach(div);
				}

				num.$destroy();

				dispose();
			}
		};
	}

	function instance$1($$self, $$props, $$invalidate) {
		let $cart;

		subscribe($$self, cart, $$value => { $cart = $$value; $$invalidate('$cart', $cart); });

		

	  let { count = 1, selected = null } = $$props;

	  const product = window.product$ || {};

	  let isValid = true;
	  let active = [];

	  function sync() {
	    if (window.cartSync) {
	      window.cartSync($cart);
	    }
	  }

	  function set(e) {
	    $$invalidate('selected', selected = product.prices.find(x => x.label === e.target.value));
	  }

	  function add() {
	    $cart.items.push({
	      id: Math.random().toString(36).substr(2, 7),
	      key: product.key,
	      qty: count,
	      ...selected,
	    });
	    $cart.status = 'added'; cart.set($cart);
	    $$invalidate('selected', selected = null);
	    $$invalidate('active', active = []);
	    $$invalidate('count', count = 1);
	    sync();
	  }

		const $$binding_groups = [[]];

		function input_change_handler() {
			active = this.__value;
			$$invalidate('active', active);
		}

		function num_value_binding(value) {
			count = value;
			$$invalidate('count', count);
		}

		function change_handler(e) { count = parseFloat(e.detail.value); $$invalidate('count', count); }

		$$self.$set = $$props => {
			if ('count' in $$props) $$invalidate('count', count = $$props.count);
			if ('selected' in $$props) $$invalidate('selected', selected = $$props.selected);
		};

		$$self.$$.update = ($$dirty = { selected: 1, count: 1 }) => {
			if ($$dirty.selected || $$dirty.count) { if (selected) {
	        $$invalidate('isValid', isValid = !selected.required || count >= selected.required);
	      } }
		};

		return {
			count,
			selected,
			product,
			isValid,
			active,
			set,
			add,
			input_change_handler,
			num_value_binding,
			change_handler,
			$$binding_groups
		};
	}

	class Product extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$1, create_fragment$1, safe_not_equal, ["count", "selected"]);
		}
	}

	new Product({ // eslint-disable-line
	  target: document.querySelector('#prod'),
	});

}());
