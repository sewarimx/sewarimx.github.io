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
		var span, button0, t1, input, t2, button1, dispose;

		return {
			c() {
				span = element("span");
				button0 = element("button");
				button0.textContent = "-";
				t1 = space();
				input = element("input");
				t2 = space();
				button1 = element("button");
				button1.textContent = "+";
				button0.className = "nosl svelte-d6l8pb";
				attr(input, "type", "number");
				input.min = "1";
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
				append(span, t1);
				append(span, input);

				input.value = ctx.value;

				add_binding_callback(() => ctx.input_binding(input, null));
				append(span, t2);
				append(span, button1);
			},

			p(changed, ctx) {
				if (changed.value) input.value = ctx.value;
				if (changed.items) {
					ctx.input_binding(null, input);
					ctx.input_binding(input, null);
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
		let { value = 0 } = $$props;

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
	    if (ref.value <= ref.getAttribute('min')) return;
	    ref.value = parseFloat(ref.value) - 1; $$invalidate('ref', ref);
	    sync();
	  }

		function input_input_handler() {
			value = to_number(this.value);
			$$invalidate('value', value);
		}

		function input_binding($$node, check) {
			ref = $$node;
			$$invalidate('ref', ref);
		}

		$$self.$set = $$props => {
			if ('value' in $$props) $$invalidate('value', value = $$props.value);
		};

		return {
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
			init(this, options, instance, create_fragment, safe_not_equal, ["value"]);
		}
	}

	/* src/app/components/Product.svelte generated by Svelte v3.3.0 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.price = list[i];
		return child_ctx;
	}

	// (45:8) {#if count > 1}
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

	// (40:2) {#each product.prices as price}
	function create_each_block(ctx) {
		var li, label, input, input_value_value, t0, t1_value = ctx.price.label, t1, t2, t3_value = formatMoney(ctx.price.value), t3, t4, dispose;

		var if_block = (ctx.count > 1) && create_if_block(ctx);

		return {
			c() {
				li = element("li");
				label = element("label");
				input = element("input");
				t0 = space();
				t1 = text(t1_value);
				t2 = text(" — $");
				t3 = text(t3_value);
				t4 = text(" MXN\n        ");
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
		var h3, t1, ul, t2, div, t3, button, t4, button_disabled_value, current, dispose;

		var each_value = ctx.product.prices;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		var num = new Number({ props: { value: ctx.count } });
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
				button.disabled = button_disabled_value = !ctx.selected;
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
				if (changed.count) num_changes.value = ctx.count;
				num.$set(num_changes);

				if ((!current || changed.selected) && button_disabled_value !== (button_disabled_value = !ctx.selected)) {
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

		function change_handler(e) { count = parseFloat(e.detail.value); $$invalidate('count', count); }

		$$self.$set = $$props => {
			if ('count' in $$props) $$invalidate('count', count = $$props.count);
			if ('selected' in $$props) $$invalidate('selected', selected = $$props.selected);
		};

		return {
			count,
			selected,
			product,
			active,
			set,
			add,
			input_change_handler,
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvZHMuanMiLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9zdmVsdGUvaW50ZXJuYWwubWpzIiwic3JjL2FwcC9zaGFyZWQvaGVscGVycy5qcyIsIm5vZGVfbW9kdWxlcy9zdmVsdGUvc3RvcmUubWpzIiwic3JjL2FwcC9zaGFyZWQvc3RvcmVzLmpzIiwic3JjL2FwcC9jb21wb25lbnRzL051bWJlci5zdmVsdGUiLCJzcmMvYXBwL2NvbXBvbmVudHMvUHJvZHVjdC5zdmVsdGUiLCJzcmMvYXBwL3Byb2RzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5jb25zdCBpZGVudGl0eSA9IHggPT4geDtcblxuZnVuY3Rpb24gYXNzaWduKHRhciwgc3JjKSB7XG5cdGZvciAoY29uc3QgayBpbiBzcmMpIHRhcltrXSA9IHNyY1trXTtcblx0cmV0dXJuIHRhcjtcbn1cblxuZnVuY3Rpb24gaXNfcHJvbWlzZSh2YWx1ZSkge1xuXHRyZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlLnRoZW4gPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGFkZF9sb2NhdGlvbihlbGVtZW50LCBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIpIHtcblx0ZWxlbWVudC5fX3N2ZWx0ZV9tZXRhID0ge1xuXHRcdGxvYzogeyBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIgfVxuXHR9O1xufVxuXG5mdW5jdGlvbiBydW4oZm4pIHtcblx0cmV0dXJuIGZuKCk7XG59XG5cbmZ1bmN0aW9uIGJsYW5rX29iamVjdCgpIHtcblx0cmV0dXJuIE9iamVjdC5jcmVhdGUobnVsbCk7XG59XG5cbmZ1bmN0aW9uIHJ1bl9hbGwoZm5zKSB7XG5cdGZucy5mb3JFYWNoKHJ1bik7XG59XG5cbmZ1bmN0aW9uIGlzX2Z1bmN0aW9uKHRoaW5nKSB7XG5cdHJldHVybiB0eXBlb2YgdGhpbmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIHNhZmVfbm90X2VxdWFsKGEsIGIpIHtcblx0cmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGIgfHwgKChhICYmIHR5cGVvZiBhID09PSAnb2JqZWN0JykgfHwgdHlwZW9mIGEgPT09ICdmdW5jdGlvbicpO1xufVxuXG5mdW5jdGlvbiBub3RfZXF1YWwoYSwgYikge1xuXHRyZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYjtcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVfc3RvcmUoc3RvcmUsIG5hbWUpIHtcblx0aWYgKCFzdG9yZSB8fCB0eXBlb2Ygc3RvcmUuc3Vic2NyaWJlICE9PSAnZnVuY3Rpb24nKSB7XG5cdFx0dGhyb3cgbmV3IEVycm9yKGAnJHtuYW1lfScgaXMgbm90IGEgc3RvcmUgd2l0aCBhICdzdWJzY3JpYmUnIG1ldGhvZGApO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHN1YnNjcmliZShjb21wb25lbnQsIHN0b3JlLCBjYWxsYmFjaykge1xuXHRjb25zdCB1bnN1YiA9IHN0b3JlLnN1YnNjcmliZShjYWxsYmFjayk7XG5cblx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kucHVzaCh1bnN1Yi51bnN1YnNjcmliZVxuXHRcdD8gKCkgPT4gdW5zdWIudW5zdWJzY3JpYmUoKVxuXHRcdDogdW5zdWIpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfc2xvdChkZWZpbml0aW9uLCBjdHgsIGZuKSB7XG5cdGlmIChkZWZpbml0aW9uKSB7XG5cdFx0Y29uc3Qgc2xvdF9jdHggPSBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgZm4pO1xuXHRcdHJldHVybiBkZWZpbml0aW9uWzBdKHNsb3RfY3R4KTtcblx0fVxufVxuXG5mdW5jdGlvbiBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgZm4pIHtcblx0cmV0dXJuIGRlZmluaXRpb25bMV1cblx0XHQ/IGFzc2lnbih7fSwgYXNzaWduKGN0eC4kJHNjb3BlLmN0eCwgZGVmaW5pdGlvblsxXShmbiA/IGZuKGN0eCkgOiB7fSkpKVxuXHRcdDogY3R4LiQkc2NvcGUuY3R4O1xufVxuXG5mdW5jdGlvbiBnZXRfc2xvdF9jaGFuZ2VzKGRlZmluaXRpb24sIGN0eCwgY2hhbmdlZCwgZm4pIHtcblx0cmV0dXJuIGRlZmluaXRpb25bMV1cblx0XHQ/IGFzc2lnbih7fSwgYXNzaWduKGN0eC4kJHNjb3BlLmNoYW5nZWQgfHwge30sIGRlZmluaXRpb25bMV0oZm4gPyBmbihjaGFuZ2VkKSA6IHt9KSkpXG5cdFx0OiBjdHguJCRzY29wZS5jaGFuZ2VkIHx8IHt9O1xufVxuXG5mdW5jdGlvbiBleGNsdWRlX2ludGVybmFsX3Byb3BzKHByb3BzKSB7XG5cdGNvbnN0IHJlc3VsdCA9IHt9O1xuXHRmb3IgKGNvbnN0IGsgaW4gcHJvcHMpIGlmIChrWzBdICE9PSAnJCcpIHJlc3VsdFtrXSA9IHByb3BzW2tdO1xuXHRyZXR1cm4gcmVzdWx0O1xufVxuXG5jb25zdCB0YXNrcyA9IG5ldyBTZXQoKTtcbmxldCBydW5uaW5nID0gZmFsc2U7XG5cbmZ1bmN0aW9uIHJ1bl90YXNrcygpIHtcblx0dGFza3MuZm9yRWFjaCh0YXNrID0+IHtcblx0XHRpZiAoIXRhc2tbMF0od2luZG93LnBlcmZvcm1hbmNlLm5vdygpKSkge1xuXHRcdFx0dGFza3MuZGVsZXRlKHRhc2spO1xuXHRcdFx0dGFza1sxXSgpO1xuXHRcdH1cblx0fSk7XG5cblx0cnVubmluZyA9IHRhc2tzLnNpemUgPiAwO1xuXHRpZiAocnVubmluZykgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJ1bl90YXNrcyk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyX2xvb3BzKCkge1xuXHQvLyBmb3IgdGVzdGluZy4uLlxuXHR0YXNrcy5mb3JFYWNoKHRhc2sgPT4gdGFza3MuZGVsZXRlKHRhc2spKTtcblx0cnVubmluZyA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBsb29wKGZuKSB7XG5cdGxldCB0YXNrO1xuXG5cdGlmICghcnVubmluZykge1xuXHRcdHJ1bm5pbmcgPSB0cnVlO1xuXHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZShydW5fdGFza3MpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRwcm9taXNlOiBuZXcgUHJvbWlzZShmdWxmaWwgPT4ge1xuXHRcdFx0dGFza3MuYWRkKHRhc2sgPSBbZm4sIGZ1bGZpbF0pO1xuXHRcdH0pLFxuXHRcdGFib3J0KCkge1xuXHRcdFx0dGFza3MuZGVsZXRlKHRhc2spO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kKHRhcmdldCwgbm9kZSkge1xuXHR0YXJnZXQuYXBwZW5kQ2hpbGQobm9kZSk7XG59XG5cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIG5vZGUsIGFuY2hvcikge1xuXHR0YXJnZXQuaW5zZXJ0QmVmb3JlKG5vZGUsIGFuY2hvciB8fCBudWxsKTtcbn1cblxuZnVuY3Rpb24gZGV0YWNoKG5vZGUpIHtcblx0bm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xufVxuXG5mdW5jdGlvbiBkZXRhY2hfYmV0d2VlbihiZWZvcmUsIGFmdGVyKSB7XG5cdHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuXHRcdGJlZm9yZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGJlZm9yZS5uZXh0U2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZShhZnRlcikge1xuXHR3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG5cdFx0YWZ0ZXIucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChhZnRlci5wcmV2aW91c1NpYmxpbmcpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9hZnRlcihiZWZvcmUpIHtcblx0d2hpbGUgKGJlZm9yZS5uZXh0U2libGluZykge1xuXHRcdGJlZm9yZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGJlZm9yZS5uZXh0U2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveV9lYWNoKGl0ZXJhdGlvbnMsIGRldGFjaGluZykge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRpZiAoaXRlcmF0aW9uc1tpXSkgaXRlcmF0aW9uc1tpXS5kKGRldGFjaGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZWxlbWVudChuYW1lKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5hbWUpO1xufVxuXG5mdW5jdGlvbiBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzKG9iaiwgZXhjbHVkZSkge1xuXHRjb25zdCB0YXJnZXQgPSB7fTtcblx0Zm9yIChjb25zdCBrIGluIG9iaikge1xuXHRcdGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrKSAmJiBleGNsdWRlLmluZGV4T2YoaykgPT09IC0xKSB7XG5cdFx0XHR0YXJnZXRba10gPSBvYmpba107XG5cdFx0fVxuXHR9XG5cdHJldHVybiB0YXJnZXQ7XG59XG5cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBuYW1lKTtcbn1cblxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKTtcbn1cblxuZnVuY3Rpb24gc3BhY2UoKSB7XG5cdHJldHVybiB0ZXh0KCcgJyk7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KCkge1xuXHRyZXR1cm4gdGV4dCgnJyk7XG59XG5cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuXHRub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuXHRyZXR1cm4gKCkgPT4gbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcbn1cblxuZnVuY3Rpb24gcHJldmVudF9kZWZhdWx0KGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cdFx0cmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuXHR9O1xufVxuXG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuXHRcdHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcblx0fTtcbn1cblxuZnVuY3Rpb24gYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUpO1xuXHRlbHNlIG5vZGUuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG5cdGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcblx0XHRpZiAoa2V5ID09PSAnc3R5bGUnKSB7XG5cdFx0XHRub2RlLnN0eWxlLmNzc1RleHQgPSBhdHRyaWJ1dGVzW2tleV07XG5cdFx0fSBlbHNlIGlmIChrZXkgaW4gbm9kZSkge1xuXHRcdFx0bm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcblx0XHR9XG5cdH1cbn1cblxuZnVuY3Rpb24gc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEobm9kZSwgcHJvcCwgdmFsdWUpIHtcblx0aWYgKHByb3AgaW4gbm9kZSkge1xuXHRcdG5vZGVbcHJvcF0gPSB2YWx1ZTtcblx0fSBlbHNlIHtcblx0XHRhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcblx0fVxufVxuXG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcblx0bm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuXHRjb25zdCB2YWx1ZSA9IFtdO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0aWYgKGdyb3VwW2ldLmNoZWNrZWQpIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG5cdH1cblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b19udW1iZXIodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlID09PSAnJyA/IHVuZGVmaW5lZCA6ICt2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdGltZV9yYW5nZXNfdG9fYXJyYXkocmFuZ2VzKSB7XG5cdGNvbnN0IGFycmF5ID0gW107XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0YXJyYXkucHVzaCh7IHN0YXJ0OiByYW5nZXMuc3RhcnQoaSksIGVuZDogcmFuZ2VzLmVuZChpKSB9KTtcblx0fVxuXHRyZXR1cm4gYXJyYXk7XG59XG5cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcblx0cmV0dXJuIEFycmF5LmZyb20oZWxlbWVudC5jaGlsZE5vZGVzKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBub2RlID0gbm9kZXNbaV07XG5cdFx0aWYgKG5vZGUubm9kZU5hbWUgPT09IG5hbWUpIHtcblx0XHRcdGZvciAobGV0IGogPSAwOyBqIDwgbm9kZS5hdHRyaWJ1dGVzLmxlbmd0aDsgaiArPSAxKSB7XG5cdFx0XHRcdGNvbnN0IGF0dHJpYnV0ZSA9IG5vZGUuYXR0cmlidXRlc1tqXTtcblx0XHRcdFx0aWYgKCFhdHRyaWJ1dGVzW2F0dHJpYnV0ZS5uYW1lXSkgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlLm5hbWUpO1xuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTsgLy8gVE9ETyBzdHJpcCB1bndhbnRlZCBhdHRyaWJ1dGVzXG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHN2ZyA/IHN2Z19lbGVtZW50KG5hbWUpIDogZWxlbWVudChuYW1lKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fdGV4dChub2RlcywgZGF0YSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuXHRcdGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG5cdFx0XHRub2RlLmRhdGEgPSBkYXRhO1xuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdGV4dChkYXRhKTtcbn1cblxuZnVuY3Rpb24gc2V0X2RhdGEodGV4dCwgZGF0YSkge1xuXHRkYXRhID0gJycgKyBkYXRhO1xuXHRpZiAodGV4dC5kYXRhICE9PSBkYXRhKSB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuXG5mdW5jdGlvbiBzZXRfaW5wdXRfdHlwZShpbnB1dCwgdHlwZSkge1xuXHR0cnkge1xuXHRcdGlucHV0LnR5cGUgPSB0eXBlO1xuXHR9IGNhdGNoIChlKSB7XG5cdFx0Ly8gZG8gbm90aGluZ1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNldF9zdHlsZShub2RlLCBrZXksIHZhbHVlKSB7XG5cdG5vZGUuc3R5bGUuc2V0UHJvcGVydHkoa2V5LCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG5cblx0XHRpZiAob3B0aW9uLl9fdmFsdWUgPT09IHZhbHVlKSB7XG5cdFx0XHRvcHRpb24uc2VsZWN0ZWQgPSB0cnVlO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0fVxufVxuXG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcblx0XHRvcHRpb24uc2VsZWN0ZWQgPSB+dmFsdWUuaW5kZXhPZihvcHRpb24uX192YWx1ZSk7XG5cdH1cbn1cblxuZnVuY3Rpb24gc2VsZWN0X3ZhbHVlKHNlbGVjdCkge1xuXHRjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcblx0cmV0dXJuIHNlbGVjdGVkX29wdGlvbiAmJiBzZWxlY3RlZF9vcHRpb24uX192YWx1ZTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuXHRyZXR1cm4gW10ubWFwLmNhbGwoc2VsZWN0LnF1ZXJ5U2VsZWN0b3JBbGwoJzpjaGVja2VkJyksIG9wdGlvbiA9PiBvcHRpb24uX192YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIoZWxlbWVudCwgZm4pIHtcblx0aWYgKGdldENvbXB1dGVkU3R5bGUoZWxlbWVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG5cdFx0ZWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG5cdH1cblxuXHRjb25zdCBvYmplY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvYmplY3QnKTtcblx0b2JqZWN0LnNldEF0dHJpYnV0ZSgnc3R5bGUnLCAnZGlzcGxheTogYmxvY2s7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgdG9wOiAwOyBsZWZ0OiAwOyBoZWlnaHQ6IDEwMCU7IHdpZHRoOiAxMDAlOyBvdmVyZmxvdzogaGlkZGVuOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogLTE7Jyk7XG5cdG9iamVjdC50eXBlID0gJ3RleHQvaHRtbCc7XG5cblx0bGV0IHdpbjtcblxuXHRvYmplY3Qub25sb2FkID0gKCkgPT4ge1xuXHRcdHdpbiA9IG9iamVjdC5jb250ZW50RG9jdW1lbnQuZGVmYXVsdFZpZXc7XG5cdFx0d2luLmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcblx0fTtcblxuXHRpZiAoL1RyaWRlbnQvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkpIHtcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdFx0b2JqZWN0LmRhdGEgPSAnYWJvdXQ6YmxhbmsnO1xuXHR9IGVsc2Uge1xuXHRcdG9iamVjdC5kYXRhID0gJ2Fib3V0OmJsYW5rJztcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGNhbmNlbDogKCkgPT4ge1xuXHRcdFx0d2luICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG5cdFx0XHRlbGVtZW50LnJlbW92ZUNoaWxkKG9iamVjdCk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVfY2xhc3MoZWxlbWVudCwgbmFtZSwgdG9nZ2xlKSB7XG5cdGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKSB7XG5cdGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcblx0ZS5pbml0Q3VzdG9tRXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlLCBkZXRhaWwpO1xuXHRyZXR1cm4gZTtcbn1cblxubGV0IHN0eWxlc2hlZXQ7XG5sZXQgYWN0aXZlID0gMDtcbmxldCBjdXJyZW50X3J1bGVzID0ge307XG5cbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuXHRsZXQgaGFzaCA9IDUzODE7XG5cdGxldCBpID0gc3RyLmxlbmd0aDtcblxuXHR3aGlsZSAoaS0tKSBoYXNoID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgXiBzdHIuY2hhckNvZGVBdChpKTtcblx0cmV0dXJuIGhhc2ggPj4+IDA7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9ydWxlKG5vZGUsIGEsIGIsIGR1cmF0aW9uLCBkZWxheSwgZWFzZSwgZm4sIHVpZCA9IDApIHtcblx0Y29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuXHRsZXQga2V5ZnJhbWVzID0gJ3tcXG4nO1xuXG5cdGZvciAobGV0IHAgPSAwOyBwIDw9IDE7IHAgKz0gc3RlcCkge1xuXHRcdGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG5cdFx0a2V5ZnJhbWVzICs9IHAgKiAxMDAgKyBgJXske2ZuKHQsIDEgLSB0KX19XFxuYDtcblx0fVxuXG5cdGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuXHRjb25zdCBuYW1lID0gYF9fc3ZlbHRlXyR7aGFzaChydWxlKX1fJHt1aWR9YDtcblxuXHRpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcblx0XHRpZiAoIXN0eWxlc2hlZXQpIHtcblx0XHRcdGNvbnN0IHN0eWxlID0gZWxlbWVudCgnc3R5bGUnKTtcblx0XHRcdGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpO1xuXHRcdFx0c3R5bGVzaGVldCA9IHN0eWxlLnNoZWV0O1xuXHRcdH1cblxuXHRcdGN1cnJlbnRfcnVsZXNbbmFtZV0gPSB0cnVlO1xuXHRcdHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG5cdH1cblxuXHRjb25zdCBhbmltYXRpb24gPSBub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJztcblx0bm9kZS5zdHlsZS5hbmltYXRpb24gPSBgJHthbmltYXRpb24gPyBgJHthbmltYXRpb259LCBgIDogYGB9JHtuYW1lfSAke2R1cmF0aW9ufW1zIGxpbmVhciAke2RlbGF5fW1zIDEgYm90aGA7XG5cblx0YWN0aXZlICs9IDE7XG5cdHJldHVybiBuYW1lO1xufVxuXG5mdW5jdGlvbiBkZWxldGVfcnVsZShub2RlLCBuYW1lKSB7XG5cdG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKVxuXHRcdC5zcGxpdCgnLCAnKVxuXHRcdC5maWx0ZXIobmFtZVxuXHRcdFx0PyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuXHRcdFx0OiBhbmltID0+IGFuaW0uaW5kZXhPZignX19zdmVsdGUnKSA9PT0gLTEgLy8gcmVtb3ZlIGFsbCBTdmVsdGUgYW5pbWF0aW9uc1xuXHRcdClcblx0XHQuam9pbignLCAnKTtcblxuXHRpZiAobmFtZSAmJiAhLS1hY3RpdmUpIGNsZWFyX3J1bGVzKCk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyX3J1bGVzKCkge1xuXHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuXHRcdGlmIChhY3RpdmUpIHJldHVybjtcblx0XHRsZXQgaSA9IHN0eWxlc2hlZXQuY3NzUnVsZXMubGVuZ3RoO1xuXHRcdHdoaWxlIChpLS0pIHN0eWxlc2hlZXQuZGVsZXRlUnVsZShpKTtcblx0XHRjdXJyZW50X3J1bGVzID0ge307XG5cdH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcblx0aWYgKCFmcm9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB0byA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdGlmIChmcm9tLmxlZnQgPT09IHRvLmxlZnQgJiYgZnJvbS5yaWdodCA9PT0gdG8ucmlnaHQgJiYgZnJvbS50b3AgPT09IHRvLnRvcCAmJiBmcm9tLmJvdHRvbSA9PT0gdG8uYm90dG9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB7XG5cdFx0ZGVsYXkgPSAwLFxuXHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdHN0YXJ0OiBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXksXG5cdFx0ZW5kID0gc3RhcnRfdGltZSArIGR1cmF0aW9uLFxuXHRcdHRpY2sgPSBub29wLFxuXHRcdGNzc1xuXHR9ID0gZm4obm9kZSwgeyBmcm9tLCB0byB9LCBwYXJhbXMpO1xuXG5cdGxldCBydW5uaW5nID0gdHJ1ZTtcblx0bGV0IHN0YXJ0ZWQgPSBmYWxzZTtcblx0bGV0IG5hbWU7XG5cblx0Y29uc3QgY3NzX3RleHQgPSBub2RlLnN0eWxlLmNzc1RleHQ7XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0aWYgKGNzcykge1xuXHRcdFx0aWYgKGRlbGF5KSBub2RlLnN0eWxlLmNzc1RleHQgPSBjc3NfdGV4dDsgLy8gVE9ETyBjcmVhdGUgZGVsYXllZCBhbmltYXRpb24gaW5zdGVhZD9cblx0XHRcdG5hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgMCwgZWFzaW5nLCBjc3MpO1xuXHRcdH1cblxuXHRcdHN0YXJ0ZWQgPSB0cnVlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3RvcCgpIHtcblx0XHRpZiAoY3NzKSBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcblx0XHRydW5uaW5nID0gZmFsc2U7XG5cdH1cblxuXHRsb29wKG5vdyA9PiB7XG5cdFx0aWYgKCFzdGFydGVkICYmIG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRzdGFydCgpO1xuXHRcdH1cblxuXHRcdGlmIChzdGFydGVkICYmIG5vdyA+PSBlbmQpIHtcblx0XHRcdHRpY2soMSwgMCk7XG5cdFx0XHRzdG9wKCk7XG5cdFx0fVxuXG5cdFx0aWYgKCFydW5uaW5nKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXG5cdFx0aWYgKHN0YXJ0ZWQpIHtcblx0XHRcdGNvbnN0IHAgPSBub3cgLSBzdGFydF90aW1lO1xuXHRcdFx0Y29uc3QgdCA9IDAgKyAxICogZWFzaW5nKHAgLyBkdXJhdGlvbik7XG5cdFx0XHR0aWNrKHQsIDEgLSB0KTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSk7XG5cblx0aWYgKGRlbGF5KSB7XG5cdFx0aWYgKGNzcykgbm9kZS5zdHlsZS5jc3NUZXh0ICs9IGNzcygwLCAxKTtcblx0fSBlbHNlIHtcblx0XHRzdGFydCgpO1xuXHR9XG5cblx0dGljaygwLCAxKTtcblxuXHRyZXR1cm4gc3RvcDtcbn1cblxuZnVuY3Rpb24gZml4X3Bvc2l0aW9uKG5vZGUpIHtcblx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXG5cdGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuXHRcdGNvbnN0IHsgd2lkdGgsIGhlaWdodCB9ID0gc3R5bGU7XG5cdFx0Y29uc3QgYSA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdFx0bm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG5cdFx0bm9kZS5zdHlsZS53aWR0aCA9IHdpZHRoO1xuXHRcdG5vZGUuc3R5bGUuaGVpZ2h0ID0gaGVpZ2h0O1xuXHRcdGNvbnN0IGIgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG5cdFx0aWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuXHRcdFx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXHRcdFx0Y29uc3QgdHJhbnNmb3JtID0gc3R5bGUudHJhbnNmb3JtID09PSAnbm9uZScgPyAnJyA6IHN0eWxlLnRyYW5zZm9ybTtcblxuXHRcdFx0bm9kZS5zdHlsZS50cmFuc2Zvcm0gPSBgJHt0cmFuc2Zvcm19IHRyYW5zbGF0ZSgke2EubGVmdCAtIGIubGVmdH1weCwgJHthLnRvcCAtIGIudG9wfXB4KWA7XG5cdFx0fVxuXHR9XG59XG5cbmxldCBjdXJyZW50X2NvbXBvbmVudDtcblxuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuXHRjdXJyZW50X2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuXHRpZiAoIWN1cnJlbnRfY29tcG9uZW50KSB0aHJvdyBuZXcgRXJyb3IoYEZ1bmN0aW9uIGNhbGxlZCBvdXRzaWRlIGNvbXBvbmVudCBpbml0aWFsaXphdGlvbmApO1xuXHRyZXR1cm4gY3VycmVudF9jb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGJlZm9yZVVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5iZWZvcmVfcmVuZGVyLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBvbk1vdW50KGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLm9uX21vdW50LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZnRlclVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5hZnRlcl9yZW5kZXIucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIG9uRGVzdHJveShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9kZXN0cm95LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudERpc3BhdGNoZXIoKSB7XG5cdGNvbnN0IGNvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdHJldHVybiAodHlwZSwgZGV0YWlsKSA9PiB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1t0eXBlXTtcblxuXHRcdGlmIChjYWxsYmFja3MpIHtcblx0XHRcdC8vIFRPRE8gYXJlIHRoZXJlIHNpdHVhdGlvbnMgd2hlcmUgZXZlbnRzIGNvdWxkIGJlIGRpc3BhdGNoZWRcblx0XHRcdC8vIGluIGEgc2VydmVyIChub24tRE9NKSBlbnZpcm9ubWVudD9cblx0XHRcdGNvbnN0IGV2ZW50ID0gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCk7XG5cdFx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IHtcblx0XHRcdFx0Zm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gc2V0Q29udGV4dChrZXksIGNvbnRleHQpIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGV4dChrZXkpIHtcblx0cmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG5cbi8vIFRPRE8gZmlndXJlIG91dCBpZiB3ZSBzdGlsbCB3YW50IHRvIHN1cHBvcnRcbi8vIHNob3J0aGFuZCBldmVudHMsIG9yIGlmIHdlIHdhbnQgdG8gaW1wbGVtZW50XG4vLyBhIHJlYWwgYnViYmxpbmcgbWVjaGFuaXNtXG5mdW5jdGlvbiBidWJibGUoY29tcG9uZW50LCBldmVudCkge1xuXHRjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuXG5cdGlmIChjYWxsYmFja3MpIHtcblx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IGZuKGV2ZW50KSk7XG5cdH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuXG5jb25zdCByZXNvbHZlZF9wcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5sZXQgdXBkYXRlX3NjaGVkdWxlZCA9IGZhbHNlO1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuXG5mdW5jdGlvbiBzY2hlZHVsZV91cGRhdGUoKSB7XG5cdGlmICghdXBkYXRlX3NjaGVkdWxlZCkge1xuXHRcdHVwZGF0ZV9zY2hlZHVsZWQgPSB0cnVlO1xuXHRcdHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gdGljaygpIHtcblx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdHJldHVybiByZXNvbHZlZF9wcm9taXNlO1xufVxuXG5mdW5jdGlvbiBhZGRfYmluZGluZ19jYWxsYmFjayhmbikge1xuXHRiaW5kaW5nX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWRkX3JlbmRlcl9jYWxsYmFjayhmbikge1xuXHRyZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZGRfZmx1c2hfY2FsbGJhY2soZm4pIHtcblx0Zmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBmbHVzaCgpIHtcblx0Y29uc3Qgc2Vlbl9jYWxsYmFja3MgPSBuZXcgU2V0KCk7XG5cblx0ZG8ge1xuXHRcdC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcblx0XHQvLyBhbmQgdXBkYXRlIGNvbXBvbmVudHNcblx0XHR3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpIHtcblx0XHRcdGNvbnN0IGNvbXBvbmVudCA9IGRpcnR5X2NvbXBvbmVudHMuc2hpZnQoKTtcblx0XHRcdHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuXHRcdFx0dXBkYXRlKGNvbXBvbmVudC4kJCk7XG5cdFx0fVxuXG5cdFx0d2hpbGUgKGJpbmRpbmdfY2FsbGJhY2tzLmxlbmd0aCkgYmluZGluZ19jYWxsYmFja3Muc2hpZnQoKSgpO1xuXG5cdFx0Ly8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG5cdFx0Ly8gYWZ0ZXJVcGRhdGUgZnVuY3Rpb25zLiBUaGlzIG1heSBjYXVzZVxuXHRcdC8vIHN1YnNlcXVlbnQgdXBkYXRlcy4uLlxuXHRcdHdoaWxlIChyZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCkge1xuXHRcdFx0Y29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzLnBvcCgpO1xuXHRcdFx0aWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG5cdFx0XHRcdGNhbGxiYWNrKCk7XG5cblx0XHRcdFx0Ly8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuXHRcdFx0XHRzZWVuX2NhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuXHRcdFx0fVxuXHRcdH1cblx0fSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuXG5cdHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG5cdFx0Zmx1c2hfY2FsbGJhY2tzLnBvcCgpKCk7XG5cdH1cblxuXHR1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZSgkJCkge1xuXHRpZiAoJCQuZnJhZ21lbnQpIHtcblx0XHQkJC51cGRhdGUoJCQuZGlydHkpO1xuXHRcdHJ1bl9hbGwoJCQuYmVmb3JlX3JlbmRlcik7XG5cdFx0JCQuZnJhZ21lbnQucCgkJC5kaXJ0eSwgJCQuY3R4KTtcblx0XHQkJC5kaXJ0eSA9IG51bGw7XG5cblx0XHQkJC5hZnRlcl9yZW5kZXIuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcblx0fVxufVxuXG5sZXQgcHJvbWlzZTtcblxuZnVuY3Rpb24gd2FpdCgpIHtcblx0aWYgKCFwcm9taXNlKSB7XG5cdFx0cHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXHRcdHByb21pc2UudGhlbigoKSA9PiB7XG5cdFx0XHRwcm9taXNlID0gbnVsbDtcblx0XHR9KTtcblx0fVxuXG5cdHJldHVybiBwcm9taXNlO1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaChub2RlLCBkaXJlY3Rpb24sIGtpbmQpIHtcblx0bm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuXG5sZXQgb3V0cm9zO1xuXG5mdW5jdGlvbiBncm91cF9vdXRyb3MoKSB7XG5cdG91dHJvcyA9IHtcblx0XHRyZW1haW5pbmc6IDAsXG5cdFx0Y2FsbGJhY2tzOiBbXVxuXHR9O1xufVxuXG5mdW5jdGlvbiBjaGVja19vdXRyb3MoKSB7XG5cdGlmICghb3V0cm9zLnJlbWFpbmluZykge1xuXHRcdHJ1bl9hbGwob3V0cm9zLmNhbGxiYWNrcyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gb25fb3V0cm8oY2FsbGJhY2spIHtcblx0b3V0cm9zLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblx0bGV0IHJ1bm5pbmcgPSBmYWxzZTtcblx0bGV0IGFuaW1hdGlvbl9uYW1lO1xuXHRsZXQgdGFzaztcblx0bGV0IHVpZCA9IDA7XG5cblx0ZnVuY3Rpb24gY2xlYW51cCgpIHtcblx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdvKCkge1xuXHRcdGNvbnN0IHtcblx0XHRcdGRlbGF5ID0gMCxcblx0XHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdFx0ZWFzaW5nID0gaWRlbnRpdHksXG5cdFx0XHR0aWNrOiB0aWNrJCQxID0gbm9vcCxcblx0XHRcdGNzc1xuXHRcdH0gPSBjb25maWc7XG5cblx0XHRpZiAoY3NzKSBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcblx0XHR0aWNrJCQxKDAsIDEpO1xuXG5cdFx0Y29uc3Qgc3RhcnRfdGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5O1xuXHRcdGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuXG5cdFx0aWYgKHRhc2spIHRhc2suYWJvcnQoKTtcblx0XHRydW5uaW5nID0gdHJ1ZTtcblxuXHRcdHRhc2sgPSBsb29wKG5vdyA9PiB7XG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAobm93ID49IGVuZF90aW1lKSB7XG5cdFx0XHRcdFx0dGljayQkMSgxLCAwKTtcblx0XHRcdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRcdFx0cmV0dXJuIHJ1bm5pbmcgPSBmYWxzZTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChub3cgPj0gc3RhcnRfdGltZSkge1xuXHRcdFx0XHRcdGNvbnN0IHQgPSBlYXNpbmcoKG5vdyAtIHN0YXJ0X3RpbWUpIC8gZHVyYXRpb24pO1xuXHRcdFx0XHRcdHRpY2skJDEodCwgMSAtIHQpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBydW5uaW5nO1xuXHRcdH0pO1xuXHR9XG5cblx0bGV0IHN0YXJ0ZWQgPSBmYWxzZTtcblxuXHRyZXR1cm4ge1xuXHRcdHN0YXJ0KCkge1xuXHRcdFx0aWYgKHN0YXJ0ZWQpIHJldHVybjtcblxuXHRcdFx0ZGVsZXRlX3J1bGUobm9kZSk7XG5cblx0XHRcdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRcdGNvbmZpZyA9IGNvbmZpZygpO1xuXHRcdFx0XHR3YWl0KCkudGhlbihnbyk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnbygpO1xuXHRcdFx0fVxuXHRcdH0sXG5cblx0XHRpbnZhbGlkYXRlKCkge1xuXHRcdFx0c3RhcnRlZCA9IGZhbHNlO1xuXHRcdH0sXG5cblx0XHRlbmQoKSB7XG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRcdHJ1bm5pbmcgPSBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zKSB7XG5cdGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuXHRsZXQgcnVubmluZyA9IHRydWU7XG5cdGxldCBhbmltYXRpb25fbmFtZTtcblxuXHRjb25zdCBncm91cCA9IG91dHJvcztcblxuXHRncm91cC5yZW1haW5pbmcgKz0gMTtcblxuXHRmdW5jdGlvbiBnbygpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0aWYgKGNzcykgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAxLCAwLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzKTtcblxuXHRcdGNvbnN0IHN0YXJ0X3RpbWUgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheTtcblx0XHRjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcblxuXHRcdGxvb3Aobm93ID0+IHtcblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGlmIChub3cgPj0gZW5kX3RpbWUpIHtcblx0XHRcdFx0XHR0aWNrJCQxKDAsIDEpO1xuXG5cdFx0XHRcdFx0aWYgKCEtLWdyb3VwLnJlbWFpbmluZykge1xuXHRcdFx0XHRcdFx0Ly8gdGhpcyB3aWxsIHJlc3VsdCBpbiBgZW5kKClgIGJlaW5nIGNhbGxlZCxcblx0XHRcdFx0XHRcdC8vIHNvIHdlIGRvbid0IG5lZWQgdG8gY2xlYW4gdXAgaGVyZVxuXHRcdFx0XHRcdFx0cnVuX2FsbChncm91cC5jYWxsYmFja3MpO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChub3cgPj0gc3RhcnRfdGltZSkge1xuXHRcdFx0XHRcdGNvbnN0IHQgPSBlYXNpbmcoKG5vdyAtIHN0YXJ0X3RpbWUpIC8gZHVyYXRpb24pO1xuXHRcdFx0XHRcdHRpY2skJDEoMSAtIHQsIHQpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBydW5uaW5nO1xuXHRcdH0pO1xuXHR9XG5cblx0aWYgKHR5cGVvZiBjb25maWcgPT09ICdmdW5jdGlvbicpIHtcblx0XHR3YWl0KCkudGhlbigoKSA9PiB7XG5cdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdGdvKCk7XG5cdFx0fSk7XG5cdH0gZWxzZSB7XG5cdFx0Z28oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0ZW5kKHJlc2V0KSB7XG5cdFx0XHRpZiAocmVzZXQgJiYgY29uZmlnLnRpY2spIHtcblx0XHRcdFx0Y29uZmlnLnRpY2soMSwgMCk7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGlmIChhbmltYXRpb25fbmFtZSkgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuXHRcdFx0XHRydW5uaW5nID0gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG5cdGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuXG5cdGxldCB0ID0gaW50cm8gPyAwIDogMTtcblxuXHRsZXQgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcblx0bGV0IHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG5cdGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG5cblx0ZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuXHRcdGlmIChhbmltYXRpb25fbmFtZSkgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuXHR9XG5cblx0ZnVuY3Rpb24gaW5pdChwcm9ncmFtLCBkdXJhdGlvbikge1xuXHRcdGNvbnN0IGQgPSBwcm9ncmFtLmIgLSB0O1xuXHRcdGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGE6IHQsXG5cdFx0XHRiOiBwcm9ncmFtLmIsXG5cdFx0XHRkLFxuXHRcdFx0ZHVyYXRpb24sXG5cdFx0XHRzdGFydDogcHJvZ3JhbS5zdGFydCxcblx0XHRcdGVuZDogcHJvZ3JhbS5zdGFydCArIGR1cmF0aW9uLFxuXHRcdFx0Z3JvdXA6IHByb2dyYW0uZ3JvdXBcblx0XHR9O1xuXHR9XG5cblx0ZnVuY3Rpb24gZ28oYikge1xuXHRcdGNvbnN0IHtcblx0XHRcdGRlbGF5ID0gMCxcblx0XHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdFx0ZWFzaW5nID0gaWRlbnRpdHksXG5cdFx0XHR0aWNrOiB0aWNrJCQxID0gbm9vcCxcblx0XHRcdGNzc1xuXHRcdH0gPSBjb25maWc7XG5cblx0XHRjb25zdCBwcm9ncmFtID0ge1xuXHRcdFx0c3RhcnQ6IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5LFxuXHRcdFx0YlxuXHRcdH07XG5cblx0XHRpZiAoIWIpIHtcblx0XHRcdHByb2dyYW0uZ3JvdXAgPSBvdXRyb3M7XG5cdFx0XHRvdXRyb3MucmVtYWluaW5nICs9IDE7XG5cdFx0fVxuXG5cdFx0aWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuXHRcdFx0cGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Ly8gaWYgdGhpcyBpcyBhbiBpbnRybywgYW5kIHRoZXJlJ3MgYSBkZWxheSwgd2UgbmVlZCB0byBkb1xuXHRcdFx0Ly8gYW4gaW5pdGlhbCB0aWNrIGFuZC9vciBhcHBseSBDU1MgYW5pbWF0aW9uIGltbWVkaWF0ZWx5XG5cdFx0XHRpZiAoY3NzKSB7XG5cdFx0XHRcdGNsZWFyX2FuaW1hdGlvbigpO1xuXHRcdFx0XHRhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIHQsIGIsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAoYikgdGljayQkMSgwLCAxKTtcblxuXHRcdFx0cnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG5cdFx0XHRhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcblxuXHRcdFx0bG9vcChub3cgPT4ge1xuXHRcdFx0XHRpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuXHRcdFx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IGluaXQocGVuZGluZ19wcm9ncmFtLCBkdXJhdGlvbik7XG5cdFx0XHRcdFx0cGVuZGluZ19wcm9ncmFtID0gbnVsbDtcblxuXHRcdFx0XHRcdGRpc3BhdGNoKG5vZGUsIHJ1bm5pbmdfcHJvZ3JhbS5iLCAnc3RhcnQnKTtcblxuXHRcdFx0XHRcdGlmIChjc3MpIHtcblx0XHRcdFx0XHRcdGNsZWFyX2FuaW1hdGlvbigpO1xuXHRcdFx0XHRcdFx0YW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChydW5uaW5nX3Byb2dyYW0pIHtcblx0XHRcdFx0XHRpZiAobm93ID49IHJ1bm5pbmdfcHJvZ3JhbS5lbmQpIHtcblx0XHRcdFx0XHRcdHRpY2skJDEodCA9IHJ1bm5pbmdfcHJvZ3JhbS5iLCAxIC0gdCk7XG5cdFx0XHRcdFx0XHRkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ2VuZCcpO1xuXG5cdFx0XHRcdFx0XHRpZiAoIXBlbmRpbmdfcHJvZ3JhbSkge1xuXHRcdFx0XHRcdFx0XHQvLyB3ZSdyZSBkb25lXG5cdFx0XHRcdFx0XHRcdGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuXHRcdFx0XHRcdFx0XHRcdC8vIGludHJvIOKAlCB3ZSBjYW4gdGlkeSB1cCBpbW1lZGlhdGVseVxuXHRcdFx0XHRcdFx0XHRcdGNsZWFyX2FuaW1hdGlvbigpO1xuXHRcdFx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdC8vIG91dHJvIOKAlCBuZWVkcyB0byBiZSBjb29yZGluYXRlZFxuXHRcdFx0XHRcdFx0XHRcdGlmICghLS1ydW5uaW5nX3Byb2dyYW0uZ3JvdXAucmVtYWluaW5nKSBydW5fYWxsKHJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5jYWxsYmFja3MpO1xuXHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IG51bGw7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0ZWxzZSBpZiAobm93ID49IHJ1bm5pbmdfcHJvZ3JhbS5zdGFydCkge1xuXHRcdFx0XHRcdFx0Y29uc3QgcCA9IG5vdyAtIHJ1bm5pbmdfcHJvZ3JhbS5zdGFydDtcblx0XHRcdFx0XHRcdHQgPSBydW5uaW5nX3Byb2dyYW0uYSArIHJ1bm5pbmdfcHJvZ3JhbS5kICogZWFzaW5nKHAgLyBydW5uaW5nX3Byb2dyYW0uZHVyYXRpb24pO1xuXHRcdFx0XHRcdFx0dGljayQkMSh0LCAxIC0gdCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cblx0XHRcdFx0cmV0dXJuICEhKHJ1bm5pbmdfcHJvZ3JhbSB8fCBwZW5kaW5nX3Byb2dyYW0pO1xuXHRcdFx0fSk7XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRydW4oYikge1xuXHRcdFx0aWYgKHR5cGVvZiBjb25maWcgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdFx0d2FpdCgpLnRoZW4oKCkgPT4ge1xuXHRcdFx0XHRcdGNvbmZpZyA9IGNvbmZpZygpO1xuXHRcdFx0XHRcdGdvKGIpO1xuXHRcdFx0XHR9KTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGdvKGIpO1xuXHRcdFx0fVxuXHRcdH0sXG5cblx0XHRlbmQoKSB7XG5cdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBoYW5kbGVfcHJvbWlzZShwcm9taXNlLCBpbmZvKSB7XG5cdGNvbnN0IHRva2VuID0gaW5mby50b2tlbiA9IHt9O1xuXG5cdGZ1bmN0aW9uIHVwZGF0ZSh0eXBlLCBpbmRleCwga2V5LCB2YWx1ZSkge1xuXHRcdGlmIChpbmZvLnRva2VuICE9PSB0b2tlbikgcmV0dXJuO1xuXG5cdFx0aW5mby5yZXNvbHZlZCA9IGtleSAmJiB7IFtrZXldOiB2YWx1ZSB9O1xuXG5cdFx0Y29uc3QgY2hpbGRfY3R4ID0gYXNzaWduKGFzc2lnbih7fSwgaW5mby5jdHgpLCBpbmZvLnJlc29sdmVkKTtcblx0XHRjb25zdCBibG9jayA9IHR5cGUgJiYgKGluZm8uY3VycmVudCA9IHR5cGUpKGNoaWxkX2N0eCk7XG5cblx0XHRpZiAoaW5mby5ibG9jaykge1xuXHRcdFx0aWYgKGluZm8uYmxvY2tzKSB7XG5cdFx0XHRcdGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG5cdFx0XHRcdFx0aWYgKGkgIT09IGluZGV4ICYmIGJsb2NrKSB7XG5cdFx0XHRcdFx0XHRncm91cF9vdXRyb3MoKTtcblx0XHRcdFx0XHRcdG9uX291dHJvKCgpID0+IHtcblx0XHRcdFx0XHRcdFx0YmxvY2suZCgxKTtcblx0XHRcdFx0XHRcdFx0aW5mby5ibG9ja3NbaV0gPSBudWxsO1xuXHRcdFx0XHRcdFx0fSk7XG5cdFx0XHRcdFx0XHRibG9jay5vKDEpO1xuXHRcdFx0XHRcdFx0Y2hlY2tfb3V0cm9zKCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9KTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGluZm8uYmxvY2suZCgxKTtcblx0XHRcdH1cblxuXHRcdFx0YmxvY2suYygpO1xuXHRcdFx0aWYgKGJsb2NrLmkpIGJsb2NrLmkoMSk7XG5cdFx0XHRibG9jay5tKGluZm8ubW91bnQoKSwgaW5mby5hbmNob3IpO1xuXG5cdFx0XHRmbHVzaCgpO1xuXHRcdH1cblxuXHRcdGluZm8uYmxvY2sgPSBibG9jaztcblx0XHRpZiAoaW5mby5ibG9ja3MpIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuXHR9XG5cblx0aWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcblx0XHRwcm9taXNlLnRoZW4odmFsdWUgPT4ge1xuXHRcdFx0dXBkYXRlKGluZm8udGhlbiwgMSwgaW5mby52YWx1ZSwgdmFsdWUpO1xuXHRcdH0sIGVycm9yID0+IHtcblx0XHRcdHVwZGF0ZShpbmZvLmNhdGNoLCAyLCBpbmZvLmVycm9yLCBlcnJvcik7XG5cdFx0fSk7XG5cblx0XHQvLyBpZiB3ZSBwcmV2aW91c2x5IGhhZCBhIHRoZW4vY2F0Y2ggYmxvY2ssIGRlc3Ryb3kgaXRcblx0XHRpZiAoaW5mby5jdXJyZW50ICE9PSBpbmZvLnBlbmRpbmcpIHtcblx0XHRcdHVwZGF0ZShpbmZvLnBlbmRpbmcsIDApO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8udGhlbikge1xuXHRcdFx0dXBkYXRlKGluZm8udGhlbiwgMSwgaW5mby52YWx1ZSwgcHJvbWlzZSk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cblx0XHRpbmZvLnJlc29sdmVkID0geyBbaW5mby52YWx1ZV06IHByb21pc2UgfTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcblx0YmxvY2suZCgxKTtcblx0bG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xufVxuXG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdG9uX291dHJvKCgpID0+IHtcblx0XHRkZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApO1xuXHR9KTtcblxuXHRibG9jay5vKDEpO1xufVxuXG5mdW5jdGlvbiBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcblx0YmxvY2suZigpO1xuXHRvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlX2tleWVkX2VhY2gob2xkX2Jsb2NrcywgY2hhbmdlZCwgZ2V0X2tleSwgZHluYW1pYywgY3R4LCBsaXN0LCBsb29rdXAsIG5vZGUsIGRlc3Ryb3ksIGNyZWF0ZV9lYWNoX2Jsb2NrLCBuZXh0LCBnZXRfY29udGV4dCkge1xuXHRsZXQgbyA9IG9sZF9ibG9ja3MubGVuZ3RoO1xuXHRsZXQgbiA9IGxpc3QubGVuZ3RoO1xuXG5cdGxldCBpID0gbztcblx0Y29uc3Qgb2xkX2luZGV4ZXMgPSB7fTtcblx0d2hpbGUgKGktLSkgb2xkX2luZGV4ZXNbb2xkX2Jsb2Nrc1tpXS5rZXldID0gaTtcblxuXHRjb25zdCBuZXdfYmxvY2tzID0gW107XG5cdGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG5cdGNvbnN0IGRlbHRhcyA9IG5ldyBNYXAoKTtcblxuXHRpID0gbjtcblx0d2hpbGUgKGktLSkge1xuXHRcdGNvbnN0IGNoaWxkX2N0eCA9IGdldF9jb250ZXh0KGN0eCwgbGlzdCwgaSk7XG5cdFx0Y29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuXHRcdGxldCBibG9jayA9IGxvb2t1cC5nZXQoa2V5KTtcblxuXHRcdGlmICghYmxvY2spIHtcblx0XHRcdGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuXHRcdFx0YmxvY2suYygpO1xuXHRcdH0gZWxzZSBpZiAoZHluYW1pYykge1xuXHRcdFx0YmxvY2sucChjaGFuZ2VkLCBjaGlsZF9jdHgpO1xuXHRcdH1cblxuXHRcdG5ld19sb29rdXAuc2V0KGtleSwgbmV3X2Jsb2Nrc1tpXSA9IGJsb2NrKTtcblxuXHRcdGlmIChrZXkgaW4gb2xkX2luZGV4ZXMpIGRlbHRhcy5zZXQoa2V5LCBNYXRoLmFicyhpIC0gb2xkX2luZGV4ZXNba2V5XSkpO1xuXHR9XG5cblx0Y29uc3Qgd2lsbF9tb3ZlID0gbmV3IFNldCgpO1xuXHRjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcblxuXHRmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcblx0XHRpZiAoYmxvY2suaSkgYmxvY2suaSgxKTtcblx0XHRibG9jay5tKG5vZGUsIG5leHQpO1xuXHRcdGxvb2t1cC5zZXQoYmxvY2sua2V5LCBibG9jayk7XG5cdFx0bmV4dCA9IGJsb2NrLmZpcnN0O1xuXHRcdG4tLTtcblx0fVxuXG5cdHdoaWxlIChvICYmIG4pIHtcblx0XHRjb25zdCBuZXdfYmxvY2sgPSBuZXdfYmxvY2tzW24gLSAxXTtcblx0XHRjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW28gLSAxXTtcblx0XHRjb25zdCBuZXdfa2V5ID0gbmV3X2Jsb2NrLmtleTtcblx0XHRjb25zdCBvbGRfa2V5ID0gb2xkX2Jsb2NrLmtleTtcblxuXHRcdGlmIChuZXdfYmxvY2sgPT09IG9sZF9ibG9jaykge1xuXHRcdFx0Ly8gZG8gbm90aGluZ1xuXHRcdFx0bmV4dCA9IG5ld19ibG9jay5maXJzdDtcblx0XHRcdG8tLTtcblx0XHRcdG4tLTtcblx0XHR9XG5cblx0XHRlbHNlIGlmICghbmV3X2xvb2t1cC5oYXMob2xkX2tleSkpIHtcblx0XHRcdC8vIHJlbW92ZSBvbGQgYmxvY2tcblx0XHRcdGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuXHRcdFx0by0tO1xuXHRcdH1cblxuXHRcdGVsc2UgaWYgKCFsb29rdXAuaGFzKG5ld19rZXkpIHx8IHdpbGxfbW92ZS5oYXMobmV3X2tleSkpIHtcblx0XHRcdGluc2VydChuZXdfYmxvY2spO1xuXHRcdH1cblxuXHRcdGVsc2UgaWYgKGRpZF9tb3ZlLmhhcyhvbGRfa2V5KSkge1xuXHRcdFx0by0tO1xuXG5cdFx0fSBlbHNlIGlmIChkZWx0YXMuZ2V0KG5ld19rZXkpID4gZGVsdGFzLmdldChvbGRfa2V5KSkge1xuXHRcdFx0ZGlkX21vdmUuYWRkKG5ld19rZXkpO1xuXHRcdFx0aW5zZXJ0KG5ld19ibG9jayk7XG5cblx0XHR9IGVsc2Uge1xuXHRcdFx0d2lsbF9tb3ZlLmFkZChvbGRfa2V5KTtcblx0XHRcdG8tLTtcblx0XHR9XG5cdH1cblxuXHR3aGlsZSAoby0tKSB7XG5cdFx0Y29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvXTtcblx0XHRpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9ibG9jay5rZXkpKSBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcblx0fVxuXG5cdHdoaWxlIChuKSBpbnNlcnQobmV3X2Jsb2Nrc1tuIC0gMV0pO1xuXG5cdHJldHVybiBuZXdfYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBtZWFzdXJlKGJsb2Nrcykge1xuXHRjb25zdCByZWN0cyA9IHt9O1xuXHRsZXQgaSA9IGJsb2Nrcy5sZW5ndGg7XG5cdHdoaWxlIChpLS0pIHJlY3RzW2Jsb2Nrc1tpXS5rZXldID0gYmxvY2tzW2ldLm5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdHJldHVybiByZWN0cztcbn1cblxuZnVuY3Rpb24gZ2V0X3NwcmVhZF91cGRhdGUobGV2ZWxzLCB1cGRhdGVzKSB7XG5cdGNvbnN0IHVwZGF0ZSA9IHt9O1xuXG5cdGNvbnN0IHRvX251bGxfb3V0ID0ge307XG5cdGNvbnN0IGFjY291bnRlZF9mb3IgPSB7ICQkc2NvcGU6IDEgfTtcblxuXHRsZXQgaSA9IGxldmVscy5sZW5ndGg7XG5cdHdoaWxlIChpLS0pIHtcblx0XHRjb25zdCBvID0gbGV2ZWxzW2ldO1xuXHRcdGNvbnN0IG4gPSB1cGRhdGVzW2ldO1xuXG5cdFx0aWYgKG4pIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG8pIHtcblx0XHRcdFx0aWYgKCEoa2V5IGluIG4pKSB0b19udWxsX291dFtrZXldID0gMTtcblx0XHRcdH1cblxuXHRcdFx0Zm9yIChjb25zdCBrZXkgaW4gbikge1xuXHRcdFx0XHRpZiAoIWFjY291bnRlZF9mb3Jba2V5XSkge1xuXHRcdFx0XHRcdHVwZGF0ZVtrZXldID0gbltrZXldO1xuXHRcdFx0XHRcdGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0bGV2ZWxzW2ldID0gbjtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Zm9yIChjb25zdCBrZXkgaW4gbykge1xuXHRcdFx0XHRhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdGZvciAoY29uc3Qga2V5IGluIHRvX251bGxfb3V0KSB7XG5cdFx0aWYgKCEoa2V5IGluIHVwZGF0ZSkpIHVwZGF0ZVtrZXldID0gdW5kZWZpbmVkO1xuXHR9XG5cblx0cmV0dXJuIHVwZGF0ZTtcbn1cblxuY29uc3QgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIgPSAvW1xccydcIj4vPVxcdXtGREQwfS1cXHV7RkRFRn1cXHV7RkZGRX1cXHV7RkZGRn1cXHV7MUZGRkV9XFx1ezFGRkZGfVxcdXsyRkZGRX1cXHV7MkZGRkZ9XFx1ezNGRkZFfVxcdXszRkZGRn1cXHV7NEZGRkV9XFx1ezRGRkZGfVxcdXs1RkZGRX1cXHV7NUZGRkZ9XFx1ezZGRkZFfVxcdXs2RkZGRn1cXHV7N0ZGRkV9XFx1ezdGRkZGfVxcdXs4RkZGRX1cXHV7OEZGRkZ9XFx1ezlGRkZFfVxcdXs5RkZGRn1cXHV7QUZGRkV9XFx1e0FGRkZGfVxcdXtCRkZGRX1cXHV7QkZGRkZ9XFx1e0NGRkZFfVxcdXtDRkZGRn1cXHV7REZGRkV9XFx1e0RGRkZGfVxcdXtFRkZGRX1cXHV7RUZGRkZ9XFx1e0ZGRkZFfVxcdXtGRkZGRn1cXHV7MTBGRkZFfVxcdXsxMEZGRkZ9XS91O1xuLy8gaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2Uvc3ludGF4Lmh0bWwjYXR0cmlidXRlcy0yXG4vLyBodHRwczovL2luZnJhLnNwZWMud2hhdHdnLm9yZy8jbm9uY2hhcmFjdGVyXG5cbmZ1bmN0aW9uIHNwcmVhZChhcmdzKSB7XG5cdGNvbnN0IGF0dHJpYnV0ZXMgPSBPYmplY3QuYXNzaWduKHt9LCAuLi5hcmdzKTtcblx0bGV0IHN0ciA9ICcnO1xuXG5cdE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmZvckVhY2gobmFtZSA9PiB7XG5cdFx0aWYgKGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLnRlc3QobmFtZSkpIHJldHVybjtcblxuXHRcdGNvbnN0IHZhbHVlID0gYXR0cmlidXRlc1tuYW1lXTtcblx0XHRpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuXHRcdGlmICh2YWx1ZSA9PT0gdHJ1ZSkgc3RyICs9IFwiIFwiICsgbmFtZTtcblxuXHRcdGNvbnN0IGVzY2FwZWQgPSBTdHJpbmcodmFsdWUpXG5cdFx0XHQucmVwbGFjZSgvXCIvZywgJyYjMzQ7Jylcblx0XHRcdC5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xuXG5cdFx0c3RyICs9IFwiIFwiICsgbmFtZSArIFwiPVwiICsgSlNPTi5zdHJpbmdpZnkoZXNjYXBlZCk7XG5cdH0pO1xuXG5cdHJldHVybiBzdHI7XG59XG5cbmNvbnN0IGVzY2FwZWQgPSB7XG5cdCdcIic6ICcmcXVvdDsnLFxuXHRcIidcIjogJyYjMzk7Jyxcblx0JyYnOiAnJmFtcDsnLFxuXHQnPCc6ICcmbHQ7Jyxcblx0Jz4nOiAnJmd0Oydcbn07XG5cbmZ1bmN0aW9uIGVzY2FwZShodG1sKSB7XG5cdHJldHVybiBTdHJpbmcoaHRtbCkucmVwbGFjZSgvW1wiJyY8Pl0vZywgbWF0Y2ggPT4gZXNjYXBlZFttYXRjaF0pO1xufVxuXG5mdW5jdGlvbiBlYWNoKGl0ZW1zLCBmbikge1xuXHRsZXQgc3RyID0gJyc7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRzdHIgKz0gZm4oaXRlbXNbaV0sIGkpO1xuXHR9XG5cdHJldHVybiBzdHI7XG59XG5cbmNvbnN0IG1pc3NpbmdfY29tcG9uZW50ID0ge1xuXHQkJHJlbmRlcjogKCkgPT4gJydcbn07XG5cbmZ1bmN0aW9uIHZhbGlkYXRlX2NvbXBvbmVudChjb21wb25lbnQsIG5hbWUpIHtcblx0aWYgKCFjb21wb25lbnQgfHwgIWNvbXBvbmVudC4kJHJlbmRlcikge1xuXHRcdGlmIChuYW1lID09PSAnc3ZlbHRlOmNvbXBvbmVudCcpIG5hbWUgKz0gJyB0aGlzPXsuLi59Jztcblx0XHR0aHJvdyBuZXcgRXJyb3IoYDwke25hbWV9PiBpcyBub3QgYSB2YWxpZCBTU1IgY29tcG9uZW50LiBZb3UgbWF5IG5lZWQgdG8gcmV2aWV3IHlvdXIgYnVpbGQgY29uZmlnIHRvIGVuc3VyZSB0aGF0IGRlcGVuZGVuY2llcyBhcmUgY29tcGlsZWQsIHJhdGhlciB0aGFuIGltcG9ydGVkIGFzIHByZS1jb21waWxlZCBtb2R1bGVzYCk7XG5cdH1cblxuXHRyZXR1cm4gY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBkZWJ1ZyhmaWxlLCBsaW5lLCBjb2x1bW4sIHZhbHVlcykge1xuXHRjb25zb2xlLmxvZyhge0BkZWJ1Z30gJHtmaWxlID8gZmlsZSArICcgJyA6ICcnfSgke2xpbmV9OiR7Y29sdW1ufSlgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdGNvbnNvbGUubG9nKHZhbHVlcyk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRyZXR1cm4gJyc7XG59XG5cbmxldCBvbl9kZXN0cm95O1xuXG5mdW5jdGlvbiBjcmVhdGVfc3NyX2NvbXBvbmVudChmbikge1xuXHRmdW5jdGlvbiAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpIHtcblx0XHRjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG5cblx0XHRjb25zdCAkJCA9IHtcblx0XHRcdG9uX2Rlc3Ryb3ksXG5cdFx0XHRjb250ZXh0OiBuZXcgTWFwKHBhcmVudF9jb21wb25lbnQgPyBwYXJlbnRfY29tcG9uZW50LiQkLmNvbnRleHQgOiBbXSksXG5cblx0XHRcdC8vIHRoZXNlIHdpbGwgYmUgaW1tZWRpYXRlbHkgZGlzY2FyZGVkXG5cdFx0XHRvbl9tb3VudDogW10sXG5cdFx0XHRiZWZvcmVfcmVuZGVyOiBbXSxcblx0XHRcdGFmdGVyX3JlbmRlcjogW10sXG5cdFx0XHRjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpXG5cdFx0fTtcblxuXHRcdHNldF9jdXJyZW50X2NvbXBvbmVudCh7ICQkIH0pO1xuXG5cdFx0Y29uc3QgaHRtbCA9IGZuKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cyk7XG5cblx0XHRzZXRfY3VycmVudF9jb21wb25lbnQocGFyZW50X2NvbXBvbmVudCk7XG5cdFx0cmV0dXJuIGh0bWw7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlbmRlcjogKHByb3BzID0ge30sIG9wdGlvbnMgPSB7fSkgPT4ge1xuXHRcdFx0b25fZGVzdHJveSA9IFtdO1xuXG5cdFx0XHRjb25zdCByZXN1bHQgPSB7IGhlYWQ6ICcnLCBjc3M6IG5ldyBTZXQoKSB9O1xuXHRcdFx0Y29uc3QgaHRtbCA9ICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIHt9LCBvcHRpb25zKTtcblxuXHRcdFx0cnVuX2FsbChvbl9kZXN0cm95KTtcblxuXHRcdFx0cmV0dXJuIHtcblx0XHRcdFx0aHRtbCxcblx0XHRcdFx0Y3NzOiB7XG5cdFx0XHRcdFx0Y29kZTogQXJyYXkuZnJvbShyZXN1bHQuY3NzKS5tYXAoY3NzID0+IGNzcy5jb2RlKS5qb2luKCdcXG4nKSxcblx0XHRcdFx0XHRtYXA6IG51bGwgLy8gVE9ET1xuXHRcdFx0XHR9LFxuXHRcdFx0XHRoZWFkOiByZXN1bHQuaGVhZFxuXHRcdFx0fTtcblx0XHR9LFxuXG5cdFx0JCRyZW5kZXJcblx0fTtcbn1cblxuZnVuY3Rpb24gZ2V0X3N0b3JlX3ZhbHVlKHN0b3JlKSB7XG5cdGxldCB2YWx1ZTtcblx0c3RvcmUuc3Vic2NyaWJlKF8gPT4gdmFsdWUgPSBfKSgpO1xuXHRyZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGJpbmQoY29tcG9uZW50LCBuYW1lLCBjYWxsYmFjaykge1xuXHRpZiAoY29tcG9uZW50LiQkLnByb3BzLmluZGV4T2YobmFtZSkgPT09IC0xKSByZXR1cm47XG5cdGNvbXBvbmVudC4kJC5ib3VuZFtuYW1lXSA9IGNhbGxiYWNrO1xuXHRjYWxsYmFjayhjb21wb25lbnQuJCQuY3R4W25hbWVdKTtcbn1cblxuZnVuY3Rpb24gbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgdGFyZ2V0LCBhbmNob3IpIHtcblx0Y29uc3QgeyBmcmFnbWVudCwgb25fbW91bnQsIG9uX2Rlc3Ryb3ksIGFmdGVyX3JlbmRlciB9ID0gY29tcG9uZW50LiQkO1xuXG5cdGZyYWdtZW50Lm0odGFyZ2V0LCBhbmNob3IpO1xuXG5cdC8vIG9uTW91bnQgaGFwcGVucyBhZnRlciB0aGUgaW5pdGlhbCBhZnRlclVwZGF0ZS4gQmVjYXVzZVxuXHQvLyBhZnRlclVwZGF0ZSBjYWxsYmFja3MgaGFwcGVuIGluIHJldmVyc2Ugb3JkZXIgKGlubmVyIGZpcnN0KVxuXHQvLyB3ZSBzY2hlZHVsZSBvbk1vdW50IGNhbGxiYWNrcyBiZWZvcmUgYWZ0ZXJVcGRhdGUgY2FsbGJhY2tzXG5cdGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4ge1xuXHRcdGNvbnN0IG5ld19vbl9kZXN0cm95ID0gb25fbW91bnQubWFwKHJ1bikuZmlsdGVyKGlzX2Z1bmN0aW9uKTtcblx0XHRpZiAob25fZGVzdHJveSkge1xuXHRcdFx0b25fZGVzdHJveS5wdXNoKC4uLm5ld19vbl9kZXN0cm95KTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0Ly8gRWRnZSBjYXNlIC0gY29tcG9uZW50IHdhcyBkZXN0cm95ZWQgaW1tZWRpYXRlbHksXG5cdFx0XHQvLyBtb3N0IGxpa2VseSBhcyBhIHJlc3VsdCBvZiBhIGJpbmRpbmcgaW5pdGlhbGlzaW5nXG5cdFx0XHRydW5fYWxsKG5ld19vbl9kZXN0cm95KTtcblx0XHR9XG5cdFx0Y29tcG9uZW50LiQkLm9uX21vdW50ID0gW107XG5cdH0pO1xuXG5cdGFmdGVyX3JlbmRlci5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBkZXN0cm95KGNvbXBvbmVudCwgZGV0YWNoaW5nKSB7XG5cdGlmIChjb21wb25lbnQuJCQpIHtcblx0XHRydW5fYWxsKGNvbXBvbmVudC4kJC5vbl9kZXN0cm95KTtcblx0XHRjb21wb25lbnQuJCQuZnJhZ21lbnQuZChkZXRhY2hpbmcpO1xuXG5cdFx0Ly8gVE9ETyBudWxsIG91dCBvdGhlciByZWZzLCBpbmNsdWRpbmcgY29tcG9uZW50LiQkIChidXQgbmVlZCB0b1xuXHRcdC8vIHByZXNlcnZlIGZpbmFsIHN0YXRlPylcblx0XHRjb21wb25lbnQuJCQub25fZGVzdHJveSA9IGNvbXBvbmVudC4kJC5mcmFnbWVudCA9IG51bGw7XG5cdFx0Y29tcG9uZW50LiQkLmN0eCA9IHt9O1xuXHR9XG59XG5cbmZ1bmN0aW9uIG1ha2VfZGlydHkoY29tcG9uZW50LCBrZXkpIHtcblx0aWYgKCFjb21wb25lbnQuJCQuZGlydHkpIHtcblx0XHRkaXJ0eV9jb21wb25lbnRzLnB1c2goY29tcG9uZW50KTtcblx0XHRzY2hlZHVsZV91cGRhdGUoKTtcblx0XHRjb21wb25lbnQuJCQuZGlydHkgPSBibGFua19vYmplY3QoKTtcblx0fVxuXHRjb21wb25lbnQuJCQuZGlydHlba2V5XSA9IHRydWU7XG59XG5cbmZ1bmN0aW9uIGluaXQoY29tcG9uZW50LCBvcHRpb25zLCBpbnN0YW5jZSwgY3JlYXRlX2ZyYWdtZW50LCBub3RfZXF1YWwkJDEsIHByb3BfbmFtZXMpIHtcblx0Y29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXHRzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcblxuXHRjb25zdCBwcm9wcyA9IG9wdGlvbnMucHJvcHMgfHwge307XG5cblx0Y29uc3QgJCQgPSBjb21wb25lbnQuJCQgPSB7XG5cdFx0ZnJhZ21lbnQ6IG51bGwsXG5cdFx0Y3R4OiBudWxsLFxuXG5cdFx0Ly8gc3RhdGVcblx0XHRwcm9wczogcHJvcF9uYW1lcyxcblx0XHR1cGRhdGU6IG5vb3AsXG5cdFx0bm90X2VxdWFsOiBub3RfZXF1YWwkJDEsXG5cdFx0Ym91bmQ6IGJsYW5rX29iamVjdCgpLFxuXG5cdFx0Ly8gbGlmZWN5Y2xlXG5cdFx0b25fbW91bnQ6IFtdLFxuXHRcdG9uX2Rlc3Ryb3k6IFtdLFxuXHRcdGJlZm9yZV9yZW5kZXI6IFtdLFxuXHRcdGFmdGVyX3JlbmRlcjogW10sXG5cdFx0Y29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuXG5cdFx0Ly8gZXZlcnl0aGluZyBlbHNlXG5cdFx0Y2FsbGJhY2tzOiBibGFua19vYmplY3QoKSxcblx0XHRkaXJ0eTogbnVsbFxuXHR9O1xuXG5cdGxldCByZWFkeSA9IGZhbHNlO1xuXG5cdCQkLmN0eCA9IGluc3RhbmNlXG5cdFx0PyBpbnN0YW5jZShjb21wb25lbnQsIHByb3BzLCAoa2V5LCB2YWx1ZSkgPT4ge1xuXHRcdFx0aWYgKCQkLmN0eCAmJiBub3RfZXF1YWwkJDEoJCQuY3R4W2tleV0sICQkLmN0eFtrZXldID0gdmFsdWUpKSB7XG5cdFx0XHRcdGlmICgkJC5ib3VuZFtrZXldKSAkJC5ib3VuZFtrZXldKHZhbHVlKTtcblx0XHRcdFx0aWYgKHJlYWR5KSBtYWtlX2RpcnR5KGNvbXBvbmVudCwga2V5KTtcblx0XHRcdH1cblx0XHR9KVxuXHRcdDogcHJvcHM7XG5cblx0JCQudXBkYXRlKCk7XG5cdHJlYWR5ID0gdHJ1ZTtcblx0cnVuX2FsbCgkJC5iZWZvcmVfcmVuZGVyKTtcblx0JCQuZnJhZ21lbnQgPSBjcmVhdGVfZnJhZ21lbnQoJCQuY3R4KTtcblxuXHRpZiAob3B0aW9ucy50YXJnZXQpIHtcblx0XHRpZiAob3B0aW9ucy5oeWRyYXRlKSB7XG5cdFx0XHQkJC5mcmFnbWVudC5sKGNoaWxkcmVuKG9wdGlvbnMudGFyZ2V0KSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdCQkLmZyYWdtZW50LmMoKTtcblx0XHR9XG5cblx0XHRpZiAob3B0aW9ucy5pbnRybyAmJiBjb21wb25lbnQuJCQuZnJhZ21lbnQuaSkgY29tcG9uZW50LiQkLmZyYWdtZW50LmkoKTtcblx0XHRtb3VudF9jb21wb25lbnQoY29tcG9uZW50LCBvcHRpb25zLnRhcmdldCwgb3B0aW9ucy5hbmNob3IpO1xuXHRcdGZsdXNoKCk7XG5cdH1cblxuXHRzZXRfY3VycmVudF9jb21wb25lbnQocGFyZW50X2NvbXBvbmVudCk7XG59XG5cbmxldCBTdmVsdGVFbGVtZW50O1xuaWYgKHR5cGVvZiBIVE1MRWxlbWVudCAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0U3ZlbHRlRWxlbWVudCA9IGNsYXNzIGV4dGVuZHMgSFRNTEVsZW1lbnQge1xuXHRcdGNvbnN0cnVjdG9yKCkge1xuXHRcdFx0c3VwZXIoKTtcblx0XHRcdHRoaXMuYXR0YWNoU2hhZG93KHsgbW9kZTogJ29wZW4nIH0pO1xuXHRcdH1cblxuXHRcdGNvbm5lY3RlZENhbGxiYWNrKCkge1xuXHRcdFx0Zm9yIChjb25zdCBrZXkgaW4gdGhpcy4kJC5zbG90dGVkKSB7XG5cdFx0XHRcdHRoaXMuYXBwZW5kQ2hpbGQodGhpcy4kJC5zbG90dGVkW2tleV0pO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGF0dHJpYnV0ZUNoYW5nZWRDYWxsYmFjayhhdHRyJCQxLCBvbGRWYWx1ZSwgbmV3VmFsdWUpIHtcblx0XHRcdHRoaXNbYXR0ciQkMV0gPSBuZXdWYWx1ZTtcblx0XHR9XG5cblx0XHQkZGVzdHJveSgpIHtcblx0XHRcdGRlc3Ryb3kodGhpcywgdHJ1ZSk7XG5cdFx0XHR0aGlzLiRkZXN0cm95ID0gbm9vcDtcblx0XHR9XG5cblx0XHQkb24odHlwZSwgY2FsbGJhY2spIHtcblx0XHRcdC8vIFRPRE8gc2hvdWxkIHRoaXMgZGVsZWdhdGUgdG8gYWRkRXZlbnRMaXN0ZW5lcj9cblx0XHRcdGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuXHRcdFx0Y2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuXG5cdFx0XHRyZXR1cm4gKCkgPT4ge1xuXHRcdFx0XHRjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcblx0XHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdCRzZXQoKSB7XG5cdFx0XHQvLyBvdmVycmlkZGVuIGJ5IGluc3RhbmNlLCBpZiBpdCBoYXMgcHJvcHNcblx0XHR9XG5cdH07XG59XG5cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudCB7XG5cdCRkZXN0cm95KCkge1xuXHRcdGRlc3Ryb3kodGhpcywgdHJ1ZSk7XG5cdFx0dGhpcy4kZGVzdHJveSA9IG5vb3A7XG5cdH1cblxuXHQkb24odHlwZSwgY2FsbGJhY2spIHtcblx0XHRjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcblx0XHRjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG5cblx0XHRyZXR1cm4gKCkgPT4ge1xuXHRcdFx0Y29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG5cdFx0XHRpZiAoaW5kZXggIT09IC0xKSBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcblx0XHR9O1xuXHR9XG5cblx0JHNldCgpIHtcblx0XHQvLyBvdmVycmlkZGVuIGJ5IGluc3RhbmNlLCBpZiBpdCBoYXMgcHJvcHNcblx0fVxufVxuXG5jbGFzcyBTdmVsdGVDb21wb25lbnREZXYgZXh0ZW5kcyBTdmVsdGVDb21wb25lbnQge1xuXHRjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG5cdFx0aWYgKCFvcHRpb25zIHx8ICghb3B0aW9ucy50YXJnZXQgJiYgIW9wdGlvbnMuJCRpbmxpbmUpKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoYCd0YXJnZXQnIGlzIGEgcmVxdWlyZWQgb3B0aW9uYCk7XG5cdFx0fVxuXG5cdFx0c3VwZXIoKTtcblx0fVxuXG5cdCRkZXN0cm95KCkge1xuXHRcdHN1cGVyLiRkZXN0cm95KCk7XG5cdFx0dGhpcy4kZGVzdHJveSA9ICgpID0+IHtcblx0XHRcdGNvbnNvbGUud2FybihgQ29tcG9uZW50IHdhcyBhbHJlYWR5IGRlc3Ryb3llZGApOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0XHR9O1xuXHR9XG59XG5cbmV4cG9ydCB7IGNyZWF0ZV9hbmltYXRpb24sIGZpeF9wb3NpdGlvbiwgaGFuZGxlX3Byb21pc2UsIGFwcGVuZCwgaW5zZXJ0LCBkZXRhY2gsIGRldGFjaF9iZXR3ZWVuLCBkZXRhY2hfYmVmb3JlLCBkZXRhY2hfYWZ0ZXIsIGRlc3Ryb3lfZWFjaCwgZWxlbWVudCwgb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcywgc3ZnX2VsZW1lbnQsIHRleHQsIHNwYWNlLCBlbXB0eSwgbGlzdGVuLCBwcmV2ZW50X2RlZmF1bHQsIHN0b3BfcHJvcGFnYXRpb24sIGF0dHIsIHNldF9hdHRyaWJ1dGVzLCBzZXRfY3VzdG9tX2VsZW1lbnRfZGF0YSwgeGxpbmtfYXR0ciwgZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUsIHRvX251bWJlciwgdGltZV9yYW5nZXNfdG9fYXJyYXksIGNoaWxkcmVuLCBjbGFpbV9lbGVtZW50LCBjbGFpbV90ZXh0LCBzZXRfZGF0YSwgc2V0X2lucHV0X3R5cGUsIHNldF9zdHlsZSwgc2VsZWN0X29wdGlvbiwgc2VsZWN0X29wdGlvbnMsIHNlbGVjdF92YWx1ZSwgc2VsZWN0X211bHRpcGxlX3ZhbHVlLCBhZGRfcmVzaXplX2xpc3RlbmVyLCB0b2dnbGVfY2xhc3MsIGN1c3RvbV9ldmVudCwgZGVzdHJveV9ibG9jaywgb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2ssIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2ssIHVwZGF0ZV9rZXllZF9lYWNoLCBtZWFzdXJlLCBjdXJyZW50X2NvbXBvbmVudCwgc2V0X2N1cnJlbnRfY29tcG9uZW50LCBiZWZvcmVVcGRhdGUsIG9uTW91bnQsIGFmdGVyVXBkYXRlLCBvbkRlc3Ryb3ksIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlciwgc2V0Q29udGV4dCwgZ2V0Q29udGV4dCwgYnViYmxlLCBjbGVhcl9sb29wcywgbG9vcCwgZGlydHlfY29tcG9uZW50cywgaW50cm9zLCBzY2hlZHVsZV91cGRhdGUsIHRpY2ssIGFkZF9iaW5kaW5nX2NhbGxiYWNrLCBhZGRfcmVuZGVyX2NhbGxiYWNrLCBhZGRfZmx1c2hfY2FsbGJhY2ssIGZsdXNoLCBnZXRfc3ByZWFkX3VwZGF0ZSwgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIsIHNwcmVhZCwgZXNjYXBlZCwgZXNjYXBlLCBlYWNoLCBtaXNzaW5nX2NvbXBvbmVudCwgdmFsaWRhdGVfY29tcG9uZW50LCBkZWJ1ZywgY3JlYXRlX3Nzcl9jb21wb25lbnQsIGdldF9zdG9yZV92YWx1ZSwgZ3JvdXBfb3V0cm9zLCBjaGVja19vdXRyb3MsIG9uX291dHJvLCBjcmVhdGVfaW5fdHJhbnNpdGlvbiwgY3JlYXRlX291dF90cmFuc2l0aW9uLCBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uLCBub29wLCBpZGVudGl0eSwgYXNzaWduLCBpc19wcm9taXNlLCBhZGRfbG9jYXRpb24sIHJ1biwgYmxhbmtfb2JqZWN0LCBydW5fYWxsLCBpc19mdW5jdGlvbiwgc2FmZV9ub3RfZXF1YWwsIG5vdF9lcXVhbCwgdmFsaWRhdGVfc3RvcmUsIHN1YnNjcmliZSwgY3JlYXRlX3Nsb3QsIGdldF9zbG90X2NvbnRleHQsIGdldF9zbG90X2NoYW5nZXMsIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMsIGJpbmQsIG1vdW50X2NvbXBvbmVudCwgaW5pdCwgU3ZlbHRlRWxlbWVudCwgU3ZlbHRlQ29tcG9uZW50LCBTdmVsdGVDb21wb25lbnREZXYgfTtcbiIsImV4cG9ydCBmdW5jdGlvbiBmb3JtYXRNb25leSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKS5yZXBsYWNlKC9cXEIoPz0oXFxkezN9KSsoPyFcXGQpKS9nLCAnLCcpO1xufVxuIiwiaW1wb3J0IHsgcnVuX2FsbCwgbm9vcCwgZ2V0X3N0b3JlX3ZhbHVlLCBzYWZlX25vdF9lcXVhbCB9IGZyb20gJy4vaW50ZXJuYWwnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVhZGFibGUodmFsdWUsIHN0YXJ0KSB7XG5cdHJldHVybiB7XG5cdFx0c3Vic2NyaWJlOiB3cml0YWJsZSh2YWx1ZSwgc3RhcnQpLnN1YnNjcmliZVxuXHR9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGFibGUodmFsdWUsIHN0YXJ0ID0gbm9vcCkge1xuXHRsZXQgc3RvcDtcblx0Y29uc3Qgc3Vic2NyaWJlcnMgPSBbXTtcblxuXHRmdW5jdGlvbiBzZXQobmV3X3ZhbHVlKSB7XG5cdFx0aWYgKHNhZmVfbm90X2VxdWFsKHZhbHVlLCBuZXdfdmFsdWUpKSB7XG5cdFx0XHR2YWx1ZSA9IG5ld192YWx1ZTtcblx0XHRcdGlmICghc3RvcCkgcmV0dXJuOyAvLyBub3QgcmVhZHlcblx0XHRcdHN1YnNjcmliZXJzLmZvckVhY2gocyA9PiBzWzFdKCkpO1xuXHRcdFx0c3Vic2NyaWJlcnMuZm9yRWFjaChzID0+IHNbMF0odmFsdWUpKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiB1cGRhdGUoZm4pIHtcblx0XHRzZXQoZm4odmFsdWUpKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHN1YnNjcmliZShydW4sIGludmFsaWRhdGUgPSBub29wKSB7XG5cdFx0Y29uc3Qgc3Vic2NyaWJlciA9IFtydW4sIGludmFsaWRhdGVdO1xuXHRcdHN1YnNjcmliZXJzLnB1c2goc3Vic2NyaWJlcik7XG5cdFx0aWYgKHN1YnNjcmliZXJzLmxlbmd0aCA9PT0gMSkgc3RvcCA9IHN0YXJ0KHNldCkgfHwgbm9vcDtcblx0XHRydW4odmFsdWUpO1xuXG5cdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdGNvbnN0IGluZGV4ID0gc3Vic2NyaWJlcnMuaW5kZXhPZihzdWJzY3JpYmVyKTtcblx0XHRcdGlmIChpbmRleCAhPT0gLTEpIHN1YnNjcmliZXJzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0XHRpZiAoc3Vic2NyaWJlcnMubGVuZ3RoID09PSAwKSBzdG9wKCk7XG5cdFx0fTtcblx0fVxuXG5cdHJldHVybiB7IHNldCwgdXBkYXRlLCBzdWJzY3JpYmUgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZWQoc3RvcmVzLCBmbiwgaW5pdGlhbF92YWx1ZSkge1xuXHRjb25zdCBzaW5nbGUgPSAhQXJyYXkuaXNBcnJheShzdG9yZXMpO1xuXHRpZiAoc2luZ2xlKSBzdG9yZXMgPSBbc3RvcmVzXTtcblxuXHRjb25zdCBhdXRvID0gZm4ubGVuZ3RoIDwgMjtcblx0bGV0IHZhbHVlID0ge307XG5cblx0cmV0dXJuIHJlYWRhYmxlKGluaXRpYWxfdmFsdWUsIHNldCA9PiB7XG5cdFx0bGV0IGluaXRlZCA9IGZhbHNlO1xuXHRcdGNvbnN0IHZhbHVlcyA9IFtdO1xuXG5cdFx0bGV0IHBlbmRpbmcgPSAwO1xuXHRcdGxldCBjbGVhbnVwID0gbm9vcDtcblxuXHRcdGNvbnN0IHN5bmMgPSAoKSA9PiB7XG5cdFx0XHRpZiAocGVuZGluZykgcmV0dXJuO1xuXHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0Y29uc3QgcmVzdWx0ID0gZm4oc2luZ2xlID8gdmFsdWVzWzBdIDogdmFsdWVzLCBzZXQpO1xuXHRcdFx0aWYgKGF1dG8pIHNldChyZXN1bHQpO1xuXHRcdFx0ZWxzZSBjbGVhbnVwID0gcmVzdWx0IHx8IG5vb3A7XG5cdFx0fTtcblxuXHRcdGNvbnN0IHVuc3Vic2NyaWJlcnMgPSBzdG9yZXMubWFwKChzdG9yZSwgaSkgPT4gc3RvcmUuc3Vic2NyaWJlKFxuXHRcdFx0dmFsdWUgPT4ge1xuXHRcdFx0XHR2YWx1ZXNbaV0gPSB2YWx1ZTtcblx0XHRcdFx0cGVuZGluZyAmPSB+KDEgPDwgaSk7XG5cdFx0XHRcdGlmIChpbml0ZWQpIHN5bmMoKTtcblx0XHRcdH0sXG5cdFx0XHQoKSA9PiB7XG5cdFx0XHRcdHBlbmRpbmcgfD0gKDEgPDwgaSk7XG5cdFx0XHR9KVxuXHRcdCk7XG5cblx0XHRpbml0ZWQgPSB0cnVlO1xuXHRcdHN5bmMoKTtcblxuXHRcdHJldHVybiBmdW5jdGlvbiBzdG9wKCkge1xuXHRcdFx0cnVuX2FsbCh1bnN1YnNjcmliZXJzKTtcblx0XHRcdGNsZWFudXAoKTtcblx0XHR9O1xuXHR9KTtcbn1cblxuZXhwb3J0IHsgZ2V0X3N0b3JlX3ZhbHVlIGFzIGdldCB9O1xuIiwiaW1wb3J0IHsgd3JpdGFibGUgfSBmcm9tICdzdmVsdGUvc3RvcmUnO1xuXG5leHBvcnQgY29uc3QgY2FydCA9IHdyaXRhYmxlKHtcbiAgaXRlbXM6IFtdLFxuICBzdGF0dXM6ICdpZGxlJyxcbn0pO1xuXG5sZXQgc2tpcDtcblxuY2FydC5zdWJzY3JpYmUoZGF0YSA9PiB7XG4gIGlmICghc2tpcCAmJiBkYXRhLnN0YXR1cyAhPT0gJ2lkbGUnKSB7XG4gICAgd2luZG93LmxvY2FsU3RvcmFnZS5jYXJ0JCA9IEpTT04uc3RyaW5naWZ5KGRhdGEpO1xuICB9XG59KTtcblxuaWYgKHdpbmRvdy5sb2NhbFN0b3JhZ2UuY2FydCQpIHtcbiAgc2tpcCA9IHRydWU7XG4gIGNhcnQudXBkYXRlKCgpID0+ICh7XG4gICAgLi4uSlNPTi5wYXJzZSh3aW5kb3cubG9jYWxTdG9yYWdlLmNhcnQkKSxcbiAgICBzdGF0dXM6ICdsb2FkZWQnLFxuICB9KSk7XG4gIHNraXAgPSBmYWxzZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQge1xuICBjYXJ0LFxufTtcbiIsIjxzY3JpcHQ+XG4gIGltcG9ydCB7IGNyZWF0ZUV2ZW50RGlzcGF0Y2hlciB9IGZyb20gJ3N2ZWx0ZSc7XG5cbiAgZXhwb3J0IGxldCB2YWx1ZSA9IDA7XG5cbiAgY29uc3QgZGlzcGF0Y2ggPSBjcmVhdGVFdmVudERpc3BhdGNoZXIoKTtcblxuICBsZXQgcmVmO1xuXG4gIGZ1bmN0aW9uIHN5bmMoKSB7XG4gICAgZGlzcGF0Y2goJ2NoYW5nZScsIHJlZik7XG4gIH1cblxuICBmdW5jdGlvbiBpbmMoKSB7XG4gICAgcmVmLnZhbHVlID0gcGFyc2VGbG9hdChyZWYudmFsdWUpICsgMTtcbiAgICBzeW5jKCk7XG4gIH1cblxuICBmdW5jdGlvbiBkZWMoKSB7XG4gICAgaWYgKHJlZi52YWx1ZSA8PSByZWYuZ2V0QXR0cmlidXRlKCdtaW4nKSkgcmV0dXJuO1xuICAgIHJlZi52YWx1ZSA9IHBhcnNlRmxvYXQocmVmLnZhbHVlKSAtIDE7XG4gICAgc3luYygpO1xuICB9XG48L3NjcmlwdD5cblxuPHN0eWxlPlxuICBzcGFuIHtcbiAgICBkaXNwbGF5OiBmbGV4O1xuICB9XG5cbiAgaW5wdXQge1xuICAgIHdpZHRoOiA2MHB4ICFpbXBvcnRhbnQ7XG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgICB6LWluZGV4OiAyO1xuICB9XG5cbiAgYnV0dG9uIHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgei1pbmRleDogMTtcbiAgfVxuPC9zdHlsZT5cblxuPHNwYW4+XG4gIDxidXR0b24gY2xhc3M9XCJub3NsXCIgb246Y2xpY2s9e2RlY30+LTwvYnV0dG9uPlxuICA8aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjFcIiBiaW5kOnRoaXM9e3JlZn0gYmluZDp2YWx1ZSBvbjpjaGFuZ2U9e3N5bmN9IC8+XG4gIDxidXR0b24gY2xhc3M9XCJub3NsXCIgb246Y2xpY2s9e2luY30+KzwvYnV0dG9uPlxuPC9zcGFuPlxuIiwiPHNjcmlwdD5cbiAgaW1wb3J0IHsgZm9ybWF0TW9uZXkgfSBmcm9tICcuLi9zaGFyZWQvaGVscGVycyc7XG4gIGltcG9ydCB7IGNhcnQgfSBmcm9tICcuLi9zaGFyZWQvc3RvcmVzJztcbiAgaW1wb3J0IE51bSBmcm9tICcuL051bWJlci5zdmVsdGUnO1xuXG4gIGV4cG9ydCBsZXQgY291bnQgPSAxO1xuICBleHBvcnQgbGV0IHNlbGVjdGVkID0gbnVsbDtcblxuICBjb25zdCBwcm9kdWN0ID0gd2luZG93LnByb2R1Y3QkIHx8IHt9O1xuXG4gIGxldCBhY3RpdmUgPSBbXTtcblxuICBmdW5jdGlvbiBzeW5jKCkge1xuICAgIGlmICh3aW5kb3cuY2FydFN5bmMpIHtcbiAgICAgIHdpbmRvdy5jYXJ0U3luYygkY2FydCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2V0KGUpIHtcbiAgICBzZWxlY3RlZCA9IHByb2R1Y3QucHJpY2VzLmZpbmQoeCA9PiB4LmxhYmVsID09PSBlLnRhcmdldC52YWx1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiBhZGQoKSB7XG4gICAgJGNhcnQuaXRlbXMucHVzaCh7XG4gICAgICBpZDogTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDcpLFxuICAgICAga2V5OiBwcm9kdWN0LmtleSxcbiAgICAgIHF0eTogY291bnQsXG4gICAgICAuLi5zZWxlY3RlZCxcbiAgICB9KTtcbiAgICAkY2FydC5zdGF0dXMgPSAnYWRkZWQnO1xuICAgIHNlbGVjdGVkID0gbnVsbDtcbiAgICBhY3RpdmUgPSBbXTtcbiAgICBjb3VudCA9IDE7XG4gICAgc3luYygpO1xuICB9XG48L3NjcmlwdD5cblxuPGgzPlByZXNlbnRhY2nDs248L2gzPlxuPHVsIGNsYXNzPVwicmVzZXRcIj5cbiAgeyNlYWNoIHByb2R1Y3QucHJpY2VzIGFzIHByaWNlfVxuICAgIDxsaT5cbiAgICAgIDxsYWJlbD5cbiAgICAgICAgPGlucHV0IHR5cGU9XCJyYWRpb1wiIG5hbWU9XCJwcmljZVwiIG9uOmNoYW5nZT17c2V0fSBiaW5kOmdyb3VwPXthY3RpdmV9IHZhbHVlPXtwcmljZS5sYWJlbH0gLz5cbiAgICAgICAge3ByaWNlLmxhYmVsfSAmbWRhc2g7ICR7Zm9ybWF0TW9uZXkocHJpY2UudmFsdWUpfSBNWE5cbiAgICAgICAgeyNpZiBjb3VudCA+IDF9XG4gICAgICAgICAgPHNtYWxsPiZ0aW1lczt7Y291bnR9ICZyYXJyOyAke2Zvcm1hdE1vbmV5KHByaWNlLnZhbHVlICogY291bnQpfSBNWE48L3NtYWxsPlxuICAgICAgICB7L2lmfVxuICAgICAgPC9sYWJlbD5cbiAgICA8L2xpPlxuICB7L2VhY2h9XG48L3VsPlxuXG48ZGl2IGNsYXNzPVwiZmxleCBzcGFjZVwiPlxuICA8TnVtIHZhbHVlPXtjb3VudH0gb246Y2hhbmdlPXtlID0+IHsgY291bnQgPSBwYXJzZUZsb2F0KGUuZGV0YWlsLnZhbHVlKSB9fSAvPlxuICA8YnV0dG9uIGRpc2FibGVkPXshc2VsZWN0ZWR9IG9uOmNsaWNrPXthZGR9IGNsYXNzPVwibm9zbCBzb2xpZC1zaGFkb3dcIj5DT01QUkFSPC9idXR0b24+XG48L2Rpdj5cbiIsImltcG9ydCBQcm9kdWN0IGZyb20gJy4vY29tcG9uZW50cy9Qcm9kdWN0LnN2ZWx0ZSc7XG5cbm5ldyBQcm9kdWN0KHsgLy8gZXNsaW50LWRpc2FibGUtbGluZVxuICB0YXJnZXQ6IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNwcm9kJyksXG59KTtcbiJdLCJuYW1lcyI6WyJjb25zdCIsImxldCJdLCJtYXBwaW5ncyI6Ijs7Q0FBQSxTQUFTLElBQUksR0FBRyxFQUFFO0FBa0JsQjtDQUNBLFNBQVMsR0FBRyxDQUFDLEVBQUUsRUFBRTtDQUNqQixDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7Q0FDYixDQUFDO0FBQ0Q7Q0FDQSxTQUFTLFlBQVksR0FBRztDQUN4QixDQUFDLE9BQU8sTUFB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