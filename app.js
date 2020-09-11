(function () {

	function noop() {}

	function assign(tar, src) {
		for (const k in src) tar[k] = src[k];
		return tar;
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

	function destroy_block(block, lookup) {
		block.d(1);
		lookup.delete(block.key);
	}

	function outro_and_destroy_block(block, lookup) {
		on_outro(() => {
			destroy_block(block, lookup);
		});

		block.o(1);
	}

	function update_keyed_each(old_blocks, changed, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
		let o = old_blocks.length;
		let n = list.length;

		let i = o;
		const old_indexes = {};
		while (i--) old_indexes[old_blocks[i].key] = i;

		const new_blocks = [];
		const new_lookup = new Map();
		const deltas = new Map();

		i = n;
		while (i--) {
			const child_ctx = get_context(ctx, list, i);
			const key = get_key(child_ctx);
			let block = lookup.get(key);

			if (!block) {
				block = create_each_block(key, child_ctx);
				block.c();
			} else if (dynamic) {
				block.p(changed, child_ctx);
			}

			new_lookup.set(key, new_blocks[i] = block);

			if (key in old_indexes) deltas.set(key, Math.abs(i - old_indexes[key]));
		}

		const will_move = new Set();
		const did_move = new Set();

		function insert(block) {
			if (block.i) block.i(1);
			block.m(node, next);
			lookup.set(block.key, block);
			next = block.first;
			n--;
		}

		while (o && n) {
			const new_block = new_blocks[n - 1];
			const old_block = old_blocks[o - 1];
			const new_key = new_block.key;
			const old_key = old_block.key;

			if (new_block === old_block) {
				// do nothing
				next = new_block.first;
				o--;
				n--;
			}

			else if (!new_lookup.has(old_key)) {
				// remove old block
				destroy(old_block, lookup);
				o--;
			}

			else if (!lookup.has(new_key) || will_move.has(new_key)) {
				insert(new_block);
			}

			else if (did_move.has(old_key)) {
				o--;

			} else if (deltas.get(new_key) > deltas.get(old_key)) {
				did_move.add(new_key);
				insert(new_block);

			} else {
				will_move.add(old_key);
				o--;
			}
		}

		while (o--) {
			const old_block = old_blocks[o];
			if (!new_lookup.has(old_block.key)) destroy(old_block, lookup);
		}

		while (n) insert(new_blocks[n - 1]);

		return new_blocks;
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

	/* src/app/components/Input.svelte generated by Svelte v3.3.0 */

	// (33:0) {:else}
	function create_else_block(ctx) {
		var input, dispose;

		var input_levels = [
			ctx.fixedProps,
			{ type: ctx.type }
		];

		var input_data = {};
		for (var i = 0; i < input_levels.length; i += 1) {
			input_data = assign(input_data, input_levels[i]);
		}

		return {
			c() {
				input = element("input");
				set_attributes(input, input_data);

				dispose = [
					listen(input, "invalid", ctx.check),
					listen(input, "input", reset),
					listen(input, "blur", ctx.update)
				];
			},

			m(target, anchor) {
				insert(target, input, anchor);
			},

			p(changed, ctx) {
				set_attributes(input, get_spread_update(input_levels, [
					(changed.fixedProps) && ctx.fixedProps,
					(changed.type) && { type: ctx.type }
				]));
			},

			d(detaching) {
				if (detaching) {
					detach(input);
				}

				run_all(dispose);
			}
		};
	}

	// (31:0) {#if type === 'textarea'}
	function create_if_block(ctx) {
		var textarea, dispose;

		var textarea_levels = [
			ctx.fixedProps
		];

		var textarea_data = {};
		for (var i = 0; i < textarea_levels.length; i += 1) {
			textarea_data = assign(textarea_data, textarea_levels[i]);
		}

		return {
			c() {
				textarea = element("textarea");
				set_attributes(textarea, textarea_data);

				dispose = [
					listen(textarea, "invalid", ctx.check),
					listen(textarea, "input", reset),
					listen(textarea, "blur", ctx.update)
				];
			},

			m(target, anchor) {
				insert(target, textarea, anchor);
			},

			p(changed, ctx) {
				set_attributes(textarea, get_spread_update(textarea_levels, [
					(changed.fixedProps) && ctx.fixedProps
				]));
			},

			d(detaching) {
				if (detaching) {
					detach(textarea);
				}

				run_all(dispose);
			}
		};
	}

	function create_fragment$1(ctx) {
		var if_block_anchor;

		function select_block_type(ctx) {
			if (ctx.type === 'textarea') return create_if_block;
			return create_else_block;
		}

		var current_block_type = select_block_type(ctx);
		var if_block = current_block_type(ctx);

		return {
			c() {
				if_block.c();
				if_block_anchor = empty();
			},

			m(target, anchor) {
				if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p(changed, ctx) {
				if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
					if_block.p(changed, ctx);
				} else {
					if_block.d(1);
					if_block = current_block_type(ctx);
					if (if_block) {
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	function reset(e) {
	  e.target.setCustomValidity('');
	}

	function instance$1($$self, $$props, $$invalidate) {
		let { type = 'text', msg = 'Por favor completa éste campo' } = $$props;

	  let savedData = {};

	  if (window.localStorage.input$) {
	    $$invalidate('savedData', savedData = JSON.parse(window.localStorage.input$));
	  }

	  function check(e) {
	    e.target.setCustomValidity('');

	    if (!e.target.validity.valid) {
	      e.target.setCustomValidity(msg);
	    }
	  }

	  function update(e) {
	    savedData[$$props.name] = e.target.value; $$invalidate('savedData', savedData);
	    window.localStorage.input$ = JSON.stringify(savedData);
	  }

		$$self.$set = $$new_props => {
			$$invalidate('$$props', $$props = assign(assign({}, $$props), $$new_props));
			if ('type' in $$props) $$invalidate('type', type = $$props.type);
			if ('msg' in $$props) $$invalidate('msg', msg = $$props.msg);
		};

		let fixedProps;

		$$self.$$.update = ($$dirty = { $$props: 1, savedData: 1 }) => {
			if ($$dirty.savedData) { $$invalidate('fixedProps', fixedProps = { ...$$props, value: $$props.value || savedData[$$props.name] || '', msg: undefined, type: undefined }); }
		};

		return {
			type,
			msg,
			check,
			update,
			fixedProps,
			$$props: $$props = exclude_internal_props($$props)
		};
	}

	class Input extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$1, create_fragment$1, safe_not_equal, ["type", "msg"]);
		}
	}

	/* src/app/components/App.svelte generated by Svelte v3.3.0 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.item = list[i];
		return child_ctx;
	}

	// (75:0) {#if done}
	function create_if_block$1(ctx) {
		var div1, div0, h2, t1, p, t3, button, dispose;

		return {
			c() {
				div1 = element("div");
				div0 = element("div");
				h2 = element("h2");
				h2.textContent = "MUCHAS GRACIAS";
				t1 = space();
				p = element("p");
				p.textContent = "Tu pedido ha sido recibido, nos comunicaremos contigo a la brevedad.";
				t3 = space();
				button = element("button");
				button.textContent = "CERRAR";
				h2.className = "biggest";
				button.className = "solid-shadow";
				div0.className = "nosl";
				div1.className = "fixed overlay";
				dispose = listen(button, "click", ctx.close);
			},

			m(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, h2);
				append(div0, t1);
				append(div0, p);
				append(div0, t3);
				append(div0, button);
			},

			p: noop,

			d(detaching) {
				if (detaching) {
					detach(div1);
				}

				dispose();
			}
		};
	}

	// (105:4) {:else}
	function create_else_block$1(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<h2>No items in your basket...</h2>`;
				li.className = "wip nosl";
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	// (88:4) {#each fixedCart as item (item.id)}
	function create_each_block(key_1, ctx) {
		var li, div0, t0, button, t2, figure, img, img_alt_value, img_src_value, t3, figcaption, div1, h2, t4_value = ctx.item.name, t4, t5, t6_value = ctx.item.label, t6, t7, t8_value = ctx.item.qty, t8, t9, b, t10, t11_value = formatMoney(ctx.item.value * ctx.item.qty), t11, current, dispose;

		function change_handler(...args) {
			return ctx.change_handler(ctx, ...args);
		}

		var num = new Number({ props: { value: ctx.item.qty } });
		num.$on("change", change_handler);

		function click_handler() {
			return ctx.click_handler(ctx);
		}

		return {
			key: key_1,

			first: null,

			c() {
				li = element("li");
				div0 = element("div");
				num.$$.fragment.c();
				t0 = space();
				button = element("button");
				button.textContent = "Eliminar";
				t2 = space();
				figure = element("figure");
				img = element("img");
				t3 = space();
				figcaption = element("figcaption");
				div1 = element("div");
				h2 = element("h2");
				t4 = text(t4_value);
				t5 = space();
				t6 = text(t6_value);
				t7 = text(" x ");
				t8 = text(t8_value);
				t9 = space();
				b = element("b");
				t10 = text("$");
				t11 = text(t11_value);
				button.className = "nosl solid-shadow";
				div0.className = "overlay";
				img.className = "nosl";
				img.alt = img_alt_value = ctx.item.name;
				img.src = img_src_value = ctx.item.image;
				h2.className = "f-100";
				b.className = "bigger";
				figcaption.className = "flex around";
				li.className = "flex";
				dispose = listen(button, "click", click_handler);
				this.first = li;
			},

			m(target, anchor) {
				insert(target, li, anchor);
				append(li, div0);
				mount_component(num, div0, null);
				append(div0, t0);
				append(div0, button);
				append(li, t2);
				append(li, figure);
				append(figure, img);
				append(figure, t3);
				append(figure, figcaption);
				append(figcaption, div1);
				append(div1, h2);
				append(h2, t4);
				append(div1, t5);
				append(div1, t6);
				append(div1, t7);
				append(div1, t8);
				append(figcaption, t9);
				append(figcaption, b);
				append(b, t10);
				append(b, t11);
				current = true;
			},

			p(changed, new_ctx) {
				ctx = new_ctx;
				var num_changes = {};
				if (changed.fixedCart) num_changes.value = ctx.item.qty;
				num.$set(num_changes);

				if ((!current || changed.fixedCart) && img_alt_value !== (img_alt_value = ctx.item.name)) {
					img.alt = img_alt_value;
				}

				if ((!current || changed.fixedCart) && img_src_value !== (img_src_value = ctx.item.image)) {
					img.src = img_src_value;
				}

				if ((!current || changed.fixedCart) && t4_value !== (t4_value = ctx.item.name)) {
					set_data(t4, t4_value);
				}

				if ((!current || changed.fixedCart) && t6_value !== (t6_value = ctx.item.label)) {
					set_data(t6, t6_value);
				}

				if ((!current || changed.fixedCart) && t8_value !== (t8_value = ctx.item.qty)) {
					set_data(t8, t8_value);
				}

				if ((!current || changed.fixedCart) && t11_value !== (t11_value = formatMoney(ctx.item.value * ctx.item.qty))) {
					set_data(t11, t11_value);
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
					detach(li);
				}

				num.$destroy();

				dispose();
			}
		};
	}

	function create_fragment$2(ctx) {
		var t0, h1, t2, div, ul, each_blocks = [], each_1_lookup = new Map(), t3, li, h3, t5, b, t6, t7_value = formatMoney(ctx.fixedCart.reduce(func, 0)), t7, t8, aside, h2, t10, p, t12, form, label0, span0, t14, t15, label1, span1, t17, t18, label2, span2, t20, t21, label3, span3, t23, t24, button, t25, button_disabled_value, form_action_value, current, dispose;

		var if_block = (ctx.done) && create_if_block$1(ctx);

		var each_value = ctx.fixedCart;

		const get_key = ctx => ctx.item.id;

		for (var i = 0; i < each_value.length; i += 1) {
			let child_ctx = get_each_context(ctx, each_value, i);
			let key = get_key(child_ctx);
			each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
		}

		var each_1_else = null;

		if (!each_value.length) {
			each_1_else = create_else_block$1();
			each_1_else.c();
		}

		var in0 = new Input({
			props: {
			required: true,
			name: "fullname",
			type: "text",
			msg: "Por favor escribe tu nombre"
		}
		});

		var in1 = new Input({
			props: {
			required: true,
			name: "emailaddr",
			type: "email",
			msg: "Por favor escribe tu correo"
		}
		});

		var in2 = new Input({
			props: {
			required: true,
			name: "phonenum",
			type: "text",
			msg: "Por favor escribe tu número"
		}
		});

		var in3 = new Input({
			props: {
			required: true,
			name: "fulladdr",
			type: "textarea",
			rows: "6",
			msg: "Por favor escribe tu dirección"
		}
		});

		return {
			c() {
				if (if_block) if_block.c();
				t0 = space();
				h1 = element("h1");
				h1.textContent = "SHOPPING LIST";
				t2 = space();
				div = element("div");
				ul = element("ul");

				for (i = 0; i < each_blocks.length; i += 1) each_blocks[i].c();

				t3 = space();
				li = element("li");
				h3 = element("h3");
				h3.textContent = "Total";
				t5 = space();
				b = element("b");
				t6 = text("$");
				t7 = text(t7_value);
				t8 = space();
				aside = element("aside");
				h2 = element("h2");
				h2.textContent = "CONTACT INFO.";
				t10 = space();
				p = element("p");
				p.textContent = "Platícanos más sobre ti, después de recibir tu pedido nos comunicaremos contigo para confirmar y agendar la entrega/pago.";
				t12 = space();
				form = element("form");
				label0 = element("label");
				span0 = element("span");
				span0.textContent = "Tu nombre:";
				t14 = space();
				in0.$$.fragment.c();
				t15 = space();
				label1 = element("label");
				span1 = element("span");
				span1.textContent = "Correo electrónico:";
				t17 = space();
				in1.$$.fragment.c();
				t18 = space();
				label2 = element("label");
				span2 = element("span");
				span2.textContent = "Número telefónico:";
				t20 = space();
				in2.$$.fragment.c();
				t21 = space();
				label3 = element("label");
				span3 = element("span");
				span3.textContent = "Dirección de entrega:";
				t23 = space();
				in3.$$.fragment.c();
				t24 = space();
				button = element("button");
				t25 = text("Realizar pedido");
				h1.className = "nosl biggest";
				b.className = "bigger";
				li.className = "flex around";
				ul.className = "reset";
				h2.className = "nosl bigger";
				p.className = "nosl";
				label0.className = "nosl";
				label1.className = "nosl";
				label2.className = "nosl";
				label3.className = "nosl";
				button.className = "nosl solid-shadow";
				button.type = "submit";
				button.disabled = button_disabled_value = !ctx.$cart.items.length;
				form.method = "post";
				form.action = form_action_value = "https://formspree.io/" + API_CODE;
				div.className = "md-flex";
				dispose = listen(form, "submit", prevent_default(ctx.submit_handler));
			},

			m(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, t0, anchor);
				insert(target, h1, anchor);
				insert(target, t2, anchor);
				insert(target, div, anchor);
				append(div, ul);

				for (i = 0; i < each_blocks.length; i += 1) each_blocks[i].m(ul, null);

				if (each_1_else) {
					each_1_else.m(ul, null);
				}

				append(ul, t3);
				append(ul, li);
				append(li, h3);
				append(li, t5);
				append(li, b);
				append(b, t6);
				append(b, t7);
				append(div, t8);
				append(div, aside);
				append(aside, h2);
				append(aside, t10);
				append(aside, p);
				append(aside, t12);
				append(aside, form);
				append(form, label0);
				append(label0, span0);
				append(label0, t14);
				mount_component(in0, label0, null);
				append(form, t15);
				append(form, label1);
				append(label1, span1);
				append(label1, t17);
				mount_component(in1, label1, null);
				append(form, t18);
				append(form, label2);
				append(label2, span2);
				append(label2, t20);
				mount_component(in2, label2, null);
				append(form, t21);
				append(form, label3);
				append(label3, span3);
				append(label3, t23);
				mount_component(in3, label3, null);
				append(form, t24);
				append(form, button);
				append(button, t25);
				current = true;
			},

			p(changed, ctx) {
				if (ctx.done) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block$1(ctx);
						if_block.c();
						if_block.m(t0.parentNode, t0);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}

				const each_value = ctx.fixedCart;

				group_outros();
				each_blocks = update_keyed_each(each_blocks, changed, get_key, 1, ctx, each_value, each_1_lookup, ul, outro_and_destroy_block, create_each_block, t3, get_each_context);
				check_outros();

				if (each_value.length) {
					if (each_1_else) {
						each_1_else.d(1);
						each_1_else = null;
					}
				} else if (!each_1_else) {
					each_1_else = create_else_block$1();
					each_1_else.c();
					each_1_else.m(ul, t3);
				}

				if ((!current || changed.fixedCart) && t7_value !== (t7_value = formatMoney(ctx.fixedCart.reduce(func, 0)))) {
					set_data(t7, t7_value);
				}

				if ((!current || changed.$cart) && button_disabled_value !== (button_disabled_value = !ctx.$cart.items.length)) {
					button.disabled = button_disabled_value;
				}
			},

			i(local) {
				if (current) return;
				for (var i = 0; i < each_value.length; i += 1) each_blocks[i].i();

				in0.$$.fragment.i(local);

				in1.$$.fragment.i(local);

				in2.$$.fragment.i(local);

				in3.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				for (i = 0; i < each_blocks.length; i += 1) each_blocks[i].o();

				in0.$$.fragment.o(local);
				in1.$$.fragment.o(local);
				in2.$$.fragment.o(local);
				in3.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(t0);
					detach(h1);
					detach(t2);
					detach(div);
				}

				for (i = 0; i < each_blocks.length; i += 1) each_blocks[i].d();

				if (each_1_else) each_1_else.d();

				in0.$destroy();

				in1.$destroy();

				in2.$destroy();

				in3.$destroy();

				dispose();
			}
		};
	}

	var API_CODE="meqrbnee";

	function func(sum, x) {
		return sum + x.total;
	}

	function instance$2($$self, $$props, $$invalidate) {
		let $cart;

		subscribe($$self, cart, $$value => { $cart = $$value; $$invalidate('$cart', $cart); });

		

	  const products = window.products$ || {};

	  let done = false;

	  function close() {
	    $$invalidate('done', done = false);
	  }

	  function sync() {
	    if (window.cartSync) {
	      window.cartSync($cart);
	    }
	  }

	  function send(e, data) {
	    const { elements, method, action } = e.target;

	    const payload = {
	      emailaddr: elements.emailaddr.value,
	      fulladdr: elements.fulladdr.value,
	      fullname: elements.fullname.value,
	      phonenum: elements.phonenum.value,
	      products: data.map(x => ({
	        qty: x.qty,
	        name: x.name,
	        cost: x.value,
	        total: x.total,
	        detail: x.label,
	      })),
	    };

	    $cart.items = []; cart.set($cart);
	    $$invalidate('done', done = true);
	    sync();

	    fetch(action, {
	      method,
	      body: JSON.stringify(payload),
	      headers: {
	        'Content-Type': 'appication/json',
	      },
	    });
	  }

	  function set(e, item) {
	    const target = $cart.items.find(x => x.id === item.id);

	    target.qty = parseFloat(e.detail.value);
	    $cart.status = 'updated'; cart.set($cart);
	    sync();
	  }

	  function rm(item) {
	    if (!confirm('¿Estás seguro?')) return;
	    $cart.items = $cart.items.filter(x => x.id !== item.id); cart.set($cart);
	    $cart.status = 'removed'; cart.set($cart);
	    sync();
	  }

		function change_handler({ item }, e) {
			return set(e, item);
		}

		function click_handler({ item }) {
			return rm(item);
		}

		function submit_handler(e) {
			return send(e, fixedCart);
		}

		let fixedCart;

		$$self.$$.update = ($$dirty = { $cart: 1 }) => {
			if ($$dirty.$cart) { $$invalidate('fixedCart', fixedCart = $cart.items.map(x => ({
	        ...x,
	        ...products[x.key],
	        total: x.value * x.qty,
	      }))); }
		};

		return {
			done,
			close,
			send,
			set,
			rm,
			$cart,
			fixedCart,
			change_handler,
			click_handler,
			submit_handler
		};
	}

	class App extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$2, create_fragment$2, safe_not_equal, []);
		}
	}

	new App({ // eslint-disable-line
	  target: document.querySelector('#app'),
	});

}());
