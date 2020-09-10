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
				form.action = form_action_value = "https://formspree.io/" + FORMSPREE_API_CODE;
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

	var FORMSPREE_API_CODE="xdowrvjr";

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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlcyI6WyJub2RlX21vZHVsZXMvc3ZlbHRlL2ludGVybmFsLm1qcyIsInNyYy9hcHAvc2hhcmVkL2hlbHBlcnMuanMiLCJub2RlX21vZHVsZXMvc3ZlbHRlL3N0b3JlLm1qcyIsInNyYy9hcHAvc2hhcmVkL3N0b3Jlcy5qcyIsInNyYy9hcHAvY29tcG9uZW50cy9OdW1iZXIuc3ZlbHRlIiwic3JjL2FwcC9jb21wb25lbnRzL0lucHV0LnN2ZWx0ZSIsInNyYy9hcHAvY29tcG9uZW50cy9BcHAuc3ZlbHRlIiwic3JjL2FwcC9hcHAuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZnVuY3Rpb24gbm9vcCgpIHt9XG5cbmNvbnN0IGlkZW50aXR5ID0geCA9PiB4O1xuXG5mdW5jdGlvbiBhc3NpZ24odGFyLCBzcmMpIHtcblx0Zm9yIChjb25zdCBrIGluIHNyYykgdGFyW2tdID0gc3JjW2tdO1xuXHRyZXR1cm4gdGFyO1xufVxuXG5mdW5jdGlvbiBpc19wcm9taXNlKHZhbHVlKSB7XG5cdHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gYWRkX2xvY2F0aW9uKGVsZW1lbnQsIGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhcikge1xuXHRlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG5cdFx0bG9jOiB7IGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhciB9XG5cdH07XG59XG5cbmZ1bmN0aW9uIHJ1bihmbikge1xuXHRyZXR1cm4gZm4oKTtcbn1cblxuZnVuY3Rpb24gYmxhbmtfb2JqZWN0KCkge1xuXHRyZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cblxuZnVuY3Rpb24gcnVuX2FsbChmbnMpIHtcblx0Zm5zLmZvckVhY2gocnVuKTtcbn1cblxuZnVuY3Rpb24gaXNfZnVuY3Rpb24odGhpbmcpIHtcblx0cmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gc2FmZV9ub3RfZXF1YWwoYSwgYikge1xuXHRyZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5cbmZ1bmN0aW9uIG5vdF9lcXVhbChhLCBiKSB7XG5cdHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZV9zdG9yZShzdG9yZSwgbmFtZSkge1xuXHRpZiAoIXN0b3JlIHx8IHR5cGVvZiBzdG9yZS5zdWJzY3JpYmUgIT09ICdmdW5jdGlvbicpIHtcblx0XHR0aHJvdyBuZXcgRXJyb3IoYCcke25hbWV9JyBpcyBub3QgYSBzdG9yZSB3aXRoIGEgJ3N1YnNjcmliZScgbWV0aG9kYCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gc3Vic2NyaWJlKGNvbXBvbmVudCwgc3RvcmUsIGNhbGxiYWNrKSB7XG5cdGNvbnN0IHVuc3ViID0gc3RvcmUuc3Vic2NyaWJlKGNhbGxiYWNrKTtcblxuXHRjb21wb25lbnQuJCQub25fZGVzdHJveS5wdXNoKHVuc3ViLnVuc3Vic2NyaWJlXG5cdFx0PyAoKSA9PiB1bnN1Yi51bnN1YnNjcmliZSgpXG5cdFx0OiB1bnN1Yik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgZm4pIHtcblx0aWYgKGRlZmluaXRpb24pIHtcblx0XHRjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCBmbik7XG5cdFx0cmV0dXJuIGRlZmluaXRpb25bMF0oc2xvdF9jdHgpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCBmbikge1xuXHRyZXR1cm4gZGVmaW5pdGlvblsxXVxuXHRcdD8gYXNzaWduKHt9LCBhc3NpZ24oY3R4LiQkc2NvcGUuY3R4LCBkZWZpbml0aW9uWzFdKGZuID8gZm4oY3R4KSA6IHt9KSkpXG5cdFx0OiBjdHguJCRzY29wZS5jdHg7XG59XG5cbmZ1bmN0aW9uIGdldF9zbG90X2NoYW5nZXMoZGVmaW5pdGlvbiwgY3R4LCBjaGFuZ2VkLCBmbikge1xuXHRyZXR1cm4gZGVmaW5pdGlvblsxXVxuXHRcdD8gYXNzaWduKHt9LCBhc3NpZ24oY3R4LiQkc2NvcGUuY2hhbmdlZCB8fCB7fSwgZGVmaW5pdGlvblsxXShmbiA/IGZuKGNoYW5nZWQpIDoge30pKSlcblx0XHQ6IGN0eC4kJHNjb3BlLmNoYW5nZWQgfHwge307XG59XG5cbmZ1bmN0aW9uIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMocHJvcHMpIHtcblx0Y29uc3QgcmVzdWx0ID0ge307XG5cdGZvciAoY29uc3QgayBpbiBwcm9wcykgaWYgKGtbMF0gIT09ICckJykgcmVzdWx0W2tdID0gcHJvcHNba107XG5cdHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xubGV0IHJ1bm5pbmcgPSBmYWxzZTtcblxuZnVuY3Rpb24gcnVuX3Rhc2tzKCkge1xuXHR0YXNrcy5mb3JFYWNoKHRhc2sgPT4ge1xuXHRcdGlmICghdGFza1swXSh3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkpKSB7XG5cdFx0XHR0YXNrcy5kZWxldGUodGFzayk7XG5cdFx0XHR0YXNrWzFdKCk7XG5cdFx0fVxuXHR9KTtcblxuXHRydW5uaW5nID0gdGFza3Muc2l6ZSA+IDA7XG5cdGlmIChydW5uaW5nKSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuX3Rhc2tzKTtcbn1cblxuZnVuY3Rpb24gY2xlYXJfbG9vcHMoKSB7XG5cdC8vIGZvciB0ZXN0aW5nLi4uXG5cdHRhc2tzLmZvckVhY2godGFzayA9PiB0YXNrcy5kZWxldGUodGFzaykpO1xuXHRydW5uaW5nID0gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGxvb3AoZm4pIHtcblx0bGV0IHRhc2s7XG5cblx0aWYgKCFydW5uaW5nKSB7XG5cdFx0cnVubmluZyA9IHRydWU7XG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJ1bl90YXNrcyk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbCA9PiB7XG5cdFx0XHR0YXNrcy5hZGQodGFzayA9IFtmbiwgZnVsZmlsXSk7XG5cdFx0fSksXG5cdFx0YWJvcnQoKSB7XG5cdFx0XHR0YXNrcy5kZWxldGUodGFzayk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG5cdHRhcmdldC5hcHBlbmRDaGlsZChub2RlKTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG5cdHRhcmdldC5pbnNlcnRCZWZvcmUobm9kZSwgYW5jaG9yIHx8IG51bGwpO1xufVxuXG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuXHRub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9iZXR3ZWVuKGJlZm9yZSwgYWZ0ZXIpIHtcblx0d2hpbGUgKGJlZm9yZS5uZXh0U2libGluZyAmJiBiZWZvcmUubmV4dFNpYmxpbmcgIT09IGFmdGVyKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXRhY2hfYmVmb3JlKGFmdGVyKSB7XG5cdHdoaWxlIChhZnRlci5wcmV2aW91c1NpYmxpbmcpIHtcblx0XHRhZnRlci5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGFmdGVyLnByZXZpb3VzU2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoX2FmdGVyKGJlZm9yZSkge1xuXHR3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXN0cm95X2VhY2goaXRlcmF0aW9ucywgZGV0YWNoaW5nKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgaXRlcmF0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGlmIChpdGVyYXRpb25zW2ldKSBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIG9iamVjdF93aXRob3V0X3Byb3BlcnRpZXMob2JqLCBleGNsdWRlKSB7XG5cdGNvbnN0IHRhcmdldCA9IHt9O1xuXHRmb3IgKGNvbnN0IGsgaW4gb2JqKSB7XG5cdFx0aWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGspICYmIGV4Y2x1ZGUuaW5kZXhPZihrKSA9PT0gLTEpIHtcblx0XHRcdHRhcmdldFtrXSA9IG9ialtrXTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gc3ZnX2VsZW1lbnQobmFtZSkge1xuXHRyZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKCdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZycsIG5hbWUpO1xufVxuXG5mdW5jdGlvbiB0ZXh0KGRhdGEpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRhdGEpO1xufVxuXG5mdW5jdGlvbiBzcGFjZSgpIHtcblx0cmV0dXJuIHRleHQoJyAnKTtcbn1cblxuZnVuY3Rpb24gZW1wdHkoKSB7XG5cdHJldHVybiB0ZXh0KCcnKTtcbn1cblxuZnVuY3Rpb24gbGlzdGVuKG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKSB7XG5cdG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG5cdHJldHVybiAoKSA9PiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xufVxuXG5mdW5jdGlvbiBwcmV2ZW50X2RlZmF1bHQoZm4pIHtcblx0cmV0dXJuIGZ1bmN0aW9uKGV2ZW50KSB7XG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTtcblx0XHRyZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG5cdH07XG59XG5cbmZ1bmN0aW9uIHN0b3BfcHJvcGFnYXRpb24oZm4pIHtcblx0cmV0dXJuIGZ1bmN0aW9uKGV2ZW50KSB7XG5cdFx0ZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG5cdFx0cmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuXHR9O1xufVxuXG5mdW5jdGlvbiBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcblx0aWYgKHZhbHVlID09IG51bGwpIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZSk7XG5cdGVsc2Ugbm9kZS5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIHNldF9hdHRyaWJ1dGVzKG5vZGUsIGF0dHJpYnV0ZXMpIHtcblx0Zm9yIChjb25zdCBrZXkgaW4gYXR0cmlidXRlcykge1xuXHRcdGlmIChrZXkgPT09ICdzdHlsZScpIHtcblx0XHRcdG5vZGUuc3R5bGUuY3NzVGV4dCA9IGF0dHJpYnV0ZXNba2V5XTtcblx0XHR9IGVsc2UgaWYgKGtleSBpbiBub2RlKSB7XG5cdFx0XHRub2RlW2tleV0gPSBhdHRyaWJ1dGVzW2tleV07XG5cdFx0fSBlbHNlIHtcblx0XHRcdGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuXHRcdH1cblx0fVxufVxuXG5mdW5jdGlvbiBzZXRfY3VzdG9tX2VsZW1lbnRfZGF0YShub2RlLCBwcm9wLCB2YWx1ZSkge1xuXHRpZiAocHJvcCBpbiBub2RlKSB7XG5cdFx0bm9kZVtwcm9wXSA9IHZhbHVlO1xuXHR9IGVsc2Uge1xuXHRcdGF0dHIobm9kZSwgcHJvcCwgdmFsdWUpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHhsaW5rX2F0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuXHRub2RlLnNldEF0dHJpYnV0ZU5TKCdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rJywgYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGdldF9iaW5kaW5nX2dyb3VwX3ZhbHVlKGdyb3VwKSB7XG5cdGNvbnN0IHZhbHVlID0gW107XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgZ3JvdXAubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRpZiAoZ3JvdXBbaV0uY2hlY2tlZCkgdmFsdWUucHVzaChncm91cFtpXS5fX3ZhbHVlKTtcblx0fVxuXHRyZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHRvX251bWJlcih2YWx1ZSkge1xuXHRyZXR1cm4gdmFsdWUgPT09ICcnID8gdW5kZWZpbmVkIDogK3ZhbHVlO1xufVxuXG5mdW5jdGlvbiB0aW1lX3Jhbmdlc190b19hcnJheShyYW5nZXMpIHtcblx0Y29uc3QgYXJyYXkgPSBbXTtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRhcnJheS5wdXNoKHsgc3RhcnQ6IHJhbmdlcy5zdGFydChpKSwgZW5kOiByYW5nZXMuZW5kKGkpIH0pO1xuXHR9XG5cdHJldHVybiBhcnJheTtcbn1cblxuZnVuY3Rpb24gY2hpbGRyZW4oZWxlbWVudCkge1xuXHRyZXR1cm4gQXJyYXkuZnJvbShlbGVtZW50LmNoaWxkTm9kZXMpO1xufVxuXG5mdW5jdGlvbiBjbGFpbV9lbGVtZW50KG5vZGVzLCBuYW1lLCBhdHRyaWJ1dGVzLCBzdmcpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG5vZGUgPSBub2Rlc1tpXTtcblx0XHRpZiAobm9kZS5ub2RlTmFtZSA9PT0gbmFtZSkge1xuXHRcdFx0Zm9yIChsZXQgaiA9IDA7IGogPCBub2RlLmF0dHJpYnV0ZXMubGVuZ3RoOyBqICs9IDEpIHtcblx0XHRcdFx0Y29uc3QgYXR0cmlidXRlID0gbm9kZS5hdHRyaWJ1dGVzW2pdO1xuXHRcdFx0XHRpZiAoIWF0dHJpYnV0ZXNbYXR0cmlidXRlLm5hbWVdKSBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUubmFtZSk7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdOyAvLyBUT0RPIHN0cmlwIHVud2FudGVkIGF0dHJpYnV0ZXNcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gc3ZnID8gc3ZnX2VsZW1lbnQobmFtZSkgOiBlbGVtZW50KG5hbWUpO1xufVxuXG5mdW5jdGlvbiBjbGFpbV90ZXh0KG5vZGVzLCBkYXRhKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBub2RlID0gbm9kZXNbaV07XG5cdFx0aWYgKG5vZGUubm9kZVR5cGUgPT09IDMpIHtcblx0XHRcdG5vZGUuZGF0YSA9IGRhdGE7XG5cdFx0XHRyZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB0ZXh0KGRhdGEpO1xufVxuXG5mdW5jdGlvbiBzZXRfZGF0YSh0ZXh0LCBkYXRhKSB7XG5cdGRhdGEgPSAnJyArIGRhdGE7XG5cdGlmICh0ZXh0LmRhdGEgIT09IGRhdGEpIHRleHQuZGF0YSA9IGRhdGE7XG59XG5cbmZ1bmN0aW9uIHNldF9pbnB1dF90eXBlKGlucHV0LCB0eXBlKSB7XG5cdHRyeSB7XG5cdFx0aW5wdXQudHlwZSA9IHR5cGU7XG5cdH0gY2F0Y2ggKGUpIHtcblx0XHQvLyBkbyBub3RoaW5nXG5cdH1cbn1cblxuZnVuY3Rpb24gc2V0X3N0eWxlKG5vZGUsIGtleSwgdmFsdWUpIHtcblx0bm9kZS5zdHlsZS5zZXRQcm9wZXJ0eShrZXksIHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0X29wdGlvbihzZWxlY3QsIHZhbHVlKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcblxuXHRcdGlmIChvcHRpb24uX192YWx1ZSA9PT0gdmFsdWUpIHtcblx0XHRcdG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHR9XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb25zKHNlbGVjdCwgdmFsdWUpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG9wdGlvbiA9IHNlbGVjdC5vcHRpb25zW2ldO1xuXHRcdG9wdGlvbi5zZWxlY3RlZCA9IH52YWx1ZS5pbmRleE9mKG9wdGlvbi5fX3ZhbHVlKTtcblx0fVxufVxuXG5mdW5jdGlvbiBzZWxlY3RfdmFsdWUoc2VsZWN0KSB7XG5cdGNvbnN0IHNlbGVjdGVkX29wdGlvbiA9IHNlbGVjdC5xdWVyeVNlbGVjdG9yKCc6Y2hlY2tlZCcpIHx8IHNlbGVjdC5vcHRpb25zWzBdO1xuXHRyZXR1cm4gc2VsZWN0ZWRfb3B0aW9uICYmIHNlbGVjdGVkX29wdGlvbi5fX3ZhbHVlO1xufVxuXG5mdW5jdGlvbiBzZWxlY3RfbXVsdGlwbGVfdmFsdWUoc2VsZWN0KSB7XG5cdHJldHVybiBbXS5tYXAuY2FsbChzZWxlY3QucXVlcnlTZWxlY3RvckFsbCgnOmNoZWNrZWQnKSwgb3B0aW9uID0+IG9wdGlvbi5fX3ZhbHVlKTtcbn1cblxuZnVuY3Rpb24gYWRkX3Jlc2l6ZV9saXN0ZW5lcihlbGVtZW50LCBmbikge1xuXHRpZiAoZ2V0Q29tcHV0ZWRTdHlsZShlbGVtZW50KS5wb3NpdGlvbiA9PT0gJ3N0YXRpYycpIHtcblx0XHRlbGVtZW50LnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcblx0fVxuXG5cdGNvbnN0IG9iamVjdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ29iamVjdCcpO1xuXHRvYmplY3Quc2V0QXR0cmlidXRlKCdzdHlsZScsICdkaXNwbGF5OiBibG9jazsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGxlZnQ6IDA7IGhlaWdodDogMTAwJTsgd2lkdGg6IDEwMCU7IG92ZXJmbG93OiBoaWRkZW47IHBvaW50ZXItZXZlbnRzOiBub25lOyB6LWluZGV4OiAtMTsnKTtcblx0b2JqZWN0LnR5cGUgPSAndGV4dC9odG1sJztcblxuXHRsZXQgd2luO1xuXG5cdG9iamVjdC5vbmxvYWQgPSAoKSA9PiB7XG5cdFx0d2luID0gb2JqZWN0LmNvbnRlbnREb2N1bWVudC5kZWZhdWx0Vmlldztcblx0XHR3aW4uYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xuXHR9O1xuXG5cdGlmICgvVHJpZGVudC8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KSkge1xuXHRcdGVsZW1lbnQuYXBwZW5kQ2hpbGQob2JqZWN0KTtcblx0XHRvYmplY3QuZGF0YSA9ICdhYm91dDpibGFuayc7XG5cdH0gZWxzZSB7XG5cdFx0b2JqZWN0LmRhdGEgPSAnYWJvdXQ6YmxhbmsnO1xuXHRcdGVsZW1lbnQuYXBwZW5kQ2hpbGQob2JqZWN0KTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0Y2FuY2VsOiAoKSA9PiB7XG5cdFx0XHR3aW4gJiYgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIgJiYgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcblx0XHRcdGVsZW1lbnQucmVtb3ZlQ2hpbGQob2JqZWN0KTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIHRvZ2dsZV9jbGFzcyhlbGVtZW50LCBuYW1lLCB0b2dnbGUpIHtcblx0ZWxlbWVudC5jbGFzc0xpc3RbdG9nZ2xlID8gJ2FkZCcgOiAncmVtb3ZlJ10obmFtZSk7XG59XG5cbmZ1bmN0aW9uIGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpIHtcblx0Y29uc3QgZSA9IGRvY3VtZW50LmNyZWF0ZUV2ZW50KCdDdXN0b21FdmVudCcpO1xuXHRlLmluaXRDdXN0b21FdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UsIGRldGFpbCk7XG5cdHJldHVybiBlO1xufVxuXG5sZXQgc3R5bGVzaGVldDtcbmxldCBhY3RpdmUgPSAwO1xubGV0IGN1cnJlbnRfcnVsZXMgPSB7fTtcblxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2Rhcmtza3lhcHAvc3RyaW5nLWhhc2gvYmxvYi9tYXN0ZXIvaW5kZXguanNcbmZ1bmN0aW9uIGhhc2goc3RyKSB7XG5cdGxldCBoYXNoID0gNTM4MTtcblx0bGV0IGkgPSBzdHIubGVuZ3RoO1xuXG5cdHdoaWxlIChpLS0pIGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSBeIHN0ci5jaGFyQ29kZUF0KGkpO1xuXHRyZXR1cm4gaGFzaCA+Pj4gMDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX3J1bGUobm9kZSwgYSwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNlLCBmbiwgdWlkID0gMCkge1xuXHRjb25zdCBzdGVwID0gMTYuNjY2IC8gZHVyYXRpb247XG5cdGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG5cblx0Zm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG5cdFx0Y29uc3QgdCA9IGEgKyAoYiAtIGEpICogZWFzZShwKTtcblx0XHRrZXlmcmFtZXMgKz0gcCAqIDEwMCArIGAleyR7Zm4odCwgMSAtIHQpfX1cXG5gO1xuXHR9XG5cblx0Y29uc3QgcnVsZSA9IGtleWZyYW1lcyArIGAxMDAlIHske2ZuKGIsIDEgLSBiKX19XFxufWA7XG5cdGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuXG5cdGlmICghY3VycmVudF9ydWxlc1tuYW1lXSkge1xuXHRcdGlmICghc3R5bGVzaGVldCkge1xuXHRcdFx0Y29uc3Qgc3R5bGUgPSBlbGVtZW50KCdzdHlsZScpO1xuXHRcdFx0ZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZSk7XG5cdFx0XHRzdHlsZXNoZWV0ID0gc3R5bGUuc2hlZXQ7XG5cdFx0fVxuXG5cdFx0Y3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG5cdFx0c3R5bGVzaGVldC5pbnNlcnRSdWxlKGBAa2V5ZnJhbWVzICR7bmFtZX0gJHtydWxlfWAsIHN0eWxlc2hlZXQuY3NzUnVsZXMubGVuZ3RoKTtcblx0fVxuXG5cdGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuXHRub2RlLnN0eWxlLmFuaW1hdGlvbiA9IGAke2FuaW1hdGlvbiA/IGAke2FuaW1hdGlvbn0sIGAgOiBgYH0ke25hbWV9ICR7ZHVyYXRpb259bXMgbGluZWFyICR7ZGVsYXl9bXMgMSBib3RoYDtcblxuXHRhY3RpdmUgKz0gMTtcblx0cmV0dXJuIG5hbWU7XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZV9ydWxlKG5vZGUsIG5hbWUpIHtcblx0bm9kZS5zdHlsZS5hbmltYXRpb24gPSAobm9kZS5zdHlsZS5hbmltYXRpb24gfHwgJycpXG5cdFx0LnNwbGl0KCcsICcpXG5cdFx0LmZpbHRlcihuYW1lXG5cdFx0XHQ/IGFuaW0gPT4gYW5pbS5pbmRleE9mKG5hbWUpIDwgMCAvLyByZW1vdmUgc3BlY2lmaWMgYW5pbWF0aW9uXG5cdFx0XHQ6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG5cdFx0KVxuXHRcdC5qb2luKCcsICcpO1xuXG5cdGlmIChuYW1lICYmICEtLWFjdGl2ZSkgY2xlYXJfcnVsZXMoKTtcbn1cblxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG5cdHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG5cdFx0aWYgKGFjdGl2ZSkgcmV0dXJuO1xuXHRcdGxldCBpID0gc3R5bGVzaGVldC5jc3NSdWxlcy5sZW5ndGg7XG5cdFx0d2hpbGUgKGktLSkgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuXHRcdGN1cnJlbnRfcnVsZXMgPSB7fTtcblx0fSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9hbmltYXRpb24obm9kZSwgZnJvbSwgZm4sIHBhcmFtcykge1xuXHRpZiAoIWZyb20pIHJldHVybiBub29wO1xuXG5cdGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0aWYgKGZyb20ubGVmdCA9PT0gdG8ubGVmdCAmJiBmcm9tLnJpZ2h0ID09PSB0by5yaWdodCAmJiBmcm9tLnRvcCA9PT0gdG8udG9wICYmIGZyb20uYm90dG9tID09PSB0by5ib3R0b20pIHJldHVybiBub29wO1xuXG5cdGNvbnN0IHtcblx0XHRkZWxheSA9IDAsXG5cdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0ZWFzaW5nID0gaWRlbnRpdHksXG5cdFx0c3RhcnQ6IHN0YXJ0X3RpbWUgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheSxcblx0XHRlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sXG5cdFx0dGljayA9IG5vb3AsXG5cdFx0Y3NzXG5cdH0gPSBmbihub2RlLCB7IGZyb20sIHRvIH0sIHBhcmFtcyk7XG5cblx0bGV0IHJ1bm5pbmcgPSB0cnVlO1xuXHRsZXQgc3RhcnRlZCA9IGZhbHNlO1xuXHRsZXQgbmFtZTtcblxuXHRjb25zdCBjc3NfdGV4dCA9IG5vZGUuc3R5bGUuY3NzVGV4dDtcblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRpZiAoY3NzKSB7XG5cdFx0XHRpZiAoZGVsYXkpIG5vZGUuc3R5bGUuY3NzVGV4dCA9IGNzc190ZXh0OyAvLyBUT0RPIGNyZWF0ZSBkZWxheWVkIGFuaW1hdGlvbiBpbnN0ZWFkP1xuXHRcdFx0bmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCAwLCBlYXNpbmcsIGNzcyk7XG5cdFx0fVxuXG5cdFx0c3RhcnRlZCA9IHRydWU7XG5cdH1cblxuXHRmdW5jdGlvbiBzdG9wKCkge1xuXHRcdGlmIChjc3MpIGRlbGV0ZV9ydWxlKG5vZGUsIG5hbWUpO1xuXHRcdHJ1bm5pbmcgPSBmYWxzZTtcblx0fVxuXG5cdGxvb3Aobm93ID0+IHtcblx0XHRpZiAoIXN0YXJ0ZWQgJiYgbm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdHN0YXJ0KCk7XG5cdFx0fVxuXG5cdFx0aWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuXHRcdFx0dGljaygxLCAwKTtcblx0XHRcdHN0b3AoKTtcblx0XHR9XG5cblx0XHRpZiAoIXJ1bm5pbmcpIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cblx0XHRpZiAoc3RhcnRlZCkge1xuXHRcdFx0Y29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG5cdFx0XHRjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcblx0XHRcdHRpY2sodCwgMSAtIHQpO1xuXHRcdH1cblxuXHRcdHJldHVybiB0cnVlO1xuXHR9KTtcblxuXHRpZiAoZGVsYXkpIHtcblx0XHRpZiAoY3NzKSBub2RlLnN0eWxlLmNzc1RleHQgKz0gY3NzKDAsIDEpO1xuXHR9IGVsc2Uge1xuXHRcdHN0YXJ0KCk7XG5cdH1cblxuXHR0aWNrKDAsIDEpO1xuXG5cdHJldHVybiBzdG9wO1xufVxuXG5mdW5jdGlvbiBmaXhfcG9zaXRpb24obm9kZSkge1xuXHRjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG5cblx0aWYgKHN0eWxlLnBvc2l0aW9uICE9PSAnYWJzb2x1dGUnICYmIHN0eWxlLnBvc2l0aW9uICE9PSAnZml4ZWQnKSB7XG5cdFx0Y29uc3QgeyB3aWR0aCwgaGVpZ2h0IH0gPSBzdHlsZTtcblx0XHRjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0XHRub2RlLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcblx0XHRub2RlLnN0eWxlLndpZHRoID0gd2lkdGg7XG5cdFx0bm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG5cdFx0Y29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cblx0XHRpZiAoYS5sZWZ0ICE9PSBiLmxlZnQgfHwgYS50b3AgIT09IGIudG9wKSB7XG5cdFx0XHRjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG5cdFx0XHRjb25zdCB0cmFuc2Zvcm0gPSBzdHlsZS50cmFuc2Zvcm0gPT09ICdub25lJyA/ICcnIDogc3R5bGUudHJhbnNmb3JtO1xuXG5cdFx0XHRub2RlLnN0eWxlLnRyYW5zZm9ybSA9IGAke3RyYW5zZm9ybX0gdHJhbnNsYXRlKCR7YS5sZWZ0IC0gYi5sZWZ0fXB4LCAke2EudG9wIC0gYi50b3B9cHgpYDtcblx0XHR9XG5cdH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuXG5mdW5jdGlvbiBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KSB7XG5cdGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBnZXRfY3VycmVudF9jb21wb25lbnQoKSB7XG5cdGlmICghY3VycmVudF9jb21wb25lbnQpIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG5cdHJldHVybiBjdXJyZW50X2NvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmJlZm9yZV9yZW5kZXIucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fbW91bnQucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmFmdGVyX3JlbmRlci5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLm9uX2Rlc3Ryb3kucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcblx0Y29uc3QgY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG5cblx0cmV0dXJuICh0eXBlLCBkZXRhaWwpID0+IHtcblx0XHRjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuXG5cdFx0aWYgKGNhbGxiYWNrcykge1xuXHRcdFx0Ly8gVE9ETyBhcmUgdGhlcmUgc2l0dWF0aW9ucyB3aGVyZSBldmVudHMgY291bGQgYmUgZGlzcGF0Y2hlZFxuXHRcdFx0Ly8gaW4gYSBzZXJ2ZXIgKG5vbi1ET00pIGVudmlyb25tZW50P1xuXHRcdFx0Y29uc3QgZXZlbnQgPSBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKTtcblx0XHRcdGNhbGxiYWNrcy5zbGljZSgpLmZvckVhY2goZm4gPT4ge1xuXHRcdFx0XHRmbi5jYWxsKGNvbXBvbmVudCwgZXZlbnQpO1xuXHRcdFx0fSk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBzZXRDb250ZXh0KGtleSwgY29udGV4dCkge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5jb250ZXh0LnNldChrZXksIGNvbnRleHQpO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZXh0KGtleSkge1xuXHRyZXR1cm4gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5nZXQoa2V5KTtcbn1cblxuLy8gVE9ETyBmaWd1cmUgb3V0IGlmIHdlIHN0aWxsIHdhbnQgdG8gc3VwcG9ydFxuLy8gc2hvcnRoYW5kIGV2ZW50cywgb3IgaWYgd2Ugd2FudCB0byBpbXBsZW1lbnRcbi8vIGEgcmVhbCBidWJibGluZyBtZWNoYW5pc21cbmZ1bmN0aW9uIGJ1YmJsZShjb21wb25lbnQsIGV2ZW50KSB7XG5cdGNvbnN0IGNhbGxiYWNrcyA9IGNvbXBvbmVudC4kJC5jYWxsYmFja3NbZXZlbnQudHlwZV07XG5cblx0aWYgKGNhbGxiYWNrcykge1xuXHRcdGNhbGxiYWNrcy5zbGljZSgpLmZvckVhY2goZm4gPT4gZm4oZXZlbnQpKTtcblx0fVxufVxuXG5jb25zdCBkaXJ0eV9jb21wb25lbnRzID0gW107XG5jb25zdCBpbnRyb3MgPSB7IGVuYWJsZWQ6IGZhbHNlIH07XG5cbmNvbnN0IHJlc29sdmVkX3Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbmxldCB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG5jb25zdCBiaW5kaW5nX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVuZGVyX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgZmx1c2hfY2FsbGJhY2tzID0gW107XG5cbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcblx0aWYgKCF1cGRhdGVfc2NoZWR1bGVkKSB7XG5cdFx0dXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG5cdFx0cmVzb2x2ZWRfcHJvbWlzZS50aGVuKGZsdXNoKTtcblx0fVxufVxuXG5mdW5jdGlvbiB0aWNrKCkge1xuXHRzY2hlZHVsZV91cGRhdGUoKTtcblx0cmV0dXJuIHJlc29sdmVkX3Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIGFkZF9iaW5kaW5nX2NhbGxiYWNrKGZuKSB7XG5cdGJpbmRpbmdfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZGRfcmVuZGVyX2NhbGxiYWNrKGZuKSB7XG5cdHJlbmRlcl9jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFkZF9mbHVzaF9jYWxsYmFjayhmbikge1xuXHRmbHVzaF9jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGZsdXNoKCkge1xuXHRjb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcblxuXHRkbyB7XG5cdFx0Ly8gZmlyc3QsIGNhbGwgYmVmb3JlVXBkYXRlIGZ1bmN0aW9uc1xuXHRcdC8vIGFuZCB1cGRhdGUgY29tcG9uZW50c1xuXHRcdHdoaWxlIChkaXJ0eV9jb21wb25lbnRzLmxlbmd0aCkge1xuXHRcdFx0Y29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50cy5zaGlmdCgpO1xuXHRcdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG5cdFx0XHR1cGRhdGUoY29tcG9uZW50LiQkKTtcblx0XHR9XG5cblx0XHR3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKSBiaW5kaW5nX2NhbGxiYWNrcy5zaGlmdCgpKCk7XG5cblx0XHQvLyB0aGVuLCBvbmNlIGNvbXBvbmVudHMgYXJlIHVwZGF0ZWQsIGNhbGxcblx0XHQvLyBhZnRlclVwZGF0ZSBmdW5jdGlvbnMuIFRoaXMgbWF5IGNhdXNlXG5cdFx0Ly8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG5cdFx0d2hpbGUgKHJlbmRlcl9jYWxsYmFja3MubGVuZ3RoKSB7XG5cdFx0XHRjb25zdCBjYWxsYmFjayA9IHJlbmRlcl9jYWxsYmFja3MucG9wKCk7XG5cdFx0XHRpZiAoIXNlZW5fY2FsbGJhY2tzLmhhcyhjYWxsYmFjaykpIHtcblx0XHRcdFx0Y2FsbGJhY2soKTtcblxuXHRcdFx0XHQvLyAuLi5zbyBndWFyZCBhZ2FpbnN0IGluZmluaXRlIGxvb3BzXG5cdFx0XHRcdHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IHdoaWxlIChkaXJ0eV9jb21wb25lbnRzLmxlbmd0aCk7XG5cblx0d2hpbGUgKGZsdXNoX2NhbGxiYWNrcy5sZW5ndGgpIHtcblx0XHRmbHVzaF9jYWxsYmFja3MucG9wKCkoKTtcblx0fVxuXG5cdHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG5cdGlmICgkJC5mcmFnbWVudCkge1xuXHRcdCQkLnVwZGF0ZSgkJC5kaXJ0eSk7XG5cdFx0cnVuX2FsbCgkJC5iZWZvcmVfcmVuZGVyKTtcblx0XHQkJC5mcmFnbWVudC5wKCQkLmRpcnR5LCAkJC5jdHgpO1xuXHRcdCQkLmRpcnR5ID0gbnVsbDtcblxuXHRcdCQkLmFmdGVyX3JlbmRlci5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuXHR9XG59XG5cbmxldCBwcm9taXNlO1xuXG5mdW5jdGlvbiB3YWl0KCkge1xuXHRpZiAoIXByb21pc2UpIHtcblx0XHRwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cdFx0cHJvbWlzZS50aGVuKCgpID0+IHtcblx0XHRcdHByb21pc2UgPSBudWxsO1xuXHRcdH0pO1xuXHR9XG5cblx0cmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoKG5vZGUsIGRpcmVjdGlvbiwga2luZCkge1xuXHRub2RlLmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KGAke2RpcmVjdGlvbiA/ICdpbnRybycgOiAnb3V0cm8nfSR7a2luZH1gKSk7XG59XG5cbmxldCBvdXRyb3M7XG5cbmZ1bmN0aW9uIGdyb3VwX291dHJvcygpIHtcblx0b3V0cm9zID0ge1xuXHRcdHJlbWFpbmluZzogMCxcblx0XHRjYWxsYmFja3M6IFtdXG5cdH07XG59XG5cbmZ1bmN0aW9uIGNoZWNrX291dHJvcygpIHtcblx0aWYgKCFvdXRyb3MucmVtYWluaW5nKSB7XG5cdFx0cnVuX2FsbChvdXRyb3MuY2FsbGJhY2tzKTtcblx0fVxufVxuXG5mdW5jdGlvbiBvbl9vdXRybyhjYWxsYmFjaykge1xuXHRvdXRyb3MuY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfaW5fdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zKSB7XG5cdGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuXHRsZXQgcnVubmluZyA9IGZhbHNlO1xuXHRsZXQgYW5pbWF0aW9uX25hbWU7XG5cdGxldCB0YXNrO1xuXHRsZXQgdWlkID0gMDtcblxuXHRmdW5jdGlvbiBjbGVhbnVwKCkge1xuXHRcdGlmIChhbmltYXRpb25fbmFtZSkgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ28oKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGlmIChjc3MpIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMCwgMSwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcywgdWlkKyspO1xuXHRcdHRpY2skJDEoMCwgMSk7XG5cblx0XHRjb25zdCBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXk7XG5cdFx0Y29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG5cblx0XHRpZiAodGFzaykgdGFzay5hYm9ydCgpO1xuXHRcdHJ1bm5pbmcgPSB0cnVlO1xuXG5cdFx0dGFzayA9IGxvb3Aobm93ID0+IHtcblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGlmIChub3cgPj0gZW5kX3RpbWUpIHtcblx0XHRcdFx0XHR0aWNrJCQxKDEsIDApO1xuXHRcdFx0XHRcdGNsZWFudXAoKTtcblx0XHRcdFx0XHRyZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRcdFx0Y29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG5cdFx0XHRcdFx0dGljayQkMSh0LCAxIC0gdCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHJ1bm5pbmc7XG5cdFx0fSk7XG5cdH1cblxuXHRsZXQgc3RhcnRlZCA9IGZhbHNlO1xuXG5cdHJldHVybiB7XG5cdFx0c3RhcnQoKSB7XG5cdFx0XHRpZiAoc3RhcnRlZCkgcmV0dXJuO1xuXG5cdFx0XHRkZWxldGVfcnVsZShub2RlKTtcblxuXHRcdFx0aWYgKHR5cGVvZiBjb25maWcgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRcdHdhaXQoKS50aGVuKGdvKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGdvKCk7XG5cdFx0XHR9XG5cdFx0fSxcblxuXHRcdGludmFsaWRhdGUoKSB7XG5cdFx0XHRzdGFydGVkID0gZmFsc2U7XG5cdFx0fSxcblxuXHRcdGVuZCgpIHtcblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGNsZWFudXAoKTtcblx0XHRcdFx0cnVubmluZyA9IGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cdGxldCBydW5uaW5nID0gdHJ1ZTtcblx0bGV0IGFuaW1hdGlvbl9uYW1lO1xuXG5cdGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuXG5cdGdyb3VwLnJlbWFpbmluZyArPSAxO1xuXG5cdGZ1bmN0aW9uIGdvKCkge1xuXHRcdGNvbnN0IHtcblx0XHRcdGRlbGF5ID0gMCxcblx0XHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdFx0ZWFzaW5nID0gaWRlbnRpdHksXG5cdFx0XHR0aWNrOiB0aWNrJCQxID0gbm9vcCxcblx0XHRcdGNzc1xuXHRcdH0gPSBjb25maWc7XG5cblx0XHRpZiAoY3NzKSBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDEsIDAsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuXG5cdFx0Y29uc3Qgc3RhcnRfdGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5O1xuXHRcdGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuXG5cdFx0bG9vcChub3cgPT4ge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKG5vdyA+PSBlbmRfdGltZSkge1xuXHRcdFx0XHRcdHRpY2skJDEoMCwgMSk7XG5cblx0XHRcdFx0XHRpZiAoIS0tZ3JvdXAucmVtYWluaW5nKSB7XG5cdFx0XHRcdFx0XHQvLyB0aGlzIHdpbGwgcmVzdWx0IGluIGBlbmQoKWAgYmVpbmcgY2FsbGVkLFxuXHRcdFx0XHRcdFx0Ly8gc28gd2UgZG9uJ3QgbmVlZCB0byBjbGVhbiB1cCBoZXJlXG5cdFx0XHRcdFx0XHRydW5fYWxsKGdyb3VwLmNhbGxiYWNrcyk7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRcdFx0Y29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG5cdFx0XHRcdFx0dGljayQkMSgxIC0gdCwgdCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHJ1bm5pbmc7XG5cdFx0fSk7XG5cdH1cblxuXHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdHdhaXQoKS50aGVuKCgpID0+IHtcblx0XHRcdGNvbmZpZyA9IGNvbmZpZygpO1xuXHRcdFx0Z28oKTtcblx0XHR9KTtcblx0fSBlbHNlIHtcblx0XHRnbygpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRlbmQocmVzZXQpIHtcblx0XHRcdGlmIChyZXNldCAmJiBjb25maWcudGljaykge1xuXHRcdFx0XHRjb25maWcudGljaygxLCAwKTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdFx0XHRcdHJ1bm5pbmcgPSBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcywgaW50cm8pIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cblx0bGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuXG5cdGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRsZXQgcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcblx0bGV0IGFuaW1hdGlvbl9uYW1lID0gbnVsbDtcblxuXHRmdW5jdGlvbiBjbGVhcl9hbmltYXRpb24oKSB7XG5cdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdH1cblxuXHRmdW5jdGlvbiBpbml0KHByb2dyYW0sIGR1cmF0aW9uKSB7XG5cdFx0Y29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG5cdFx0ZHVyYXRpb24gKj0gTWF0aC5hYnMoZCk7XG5cblx0XHRyZXR1cm4ge1xuXHRcdFx0YTogdCxcblx0XHRcdGI6IHByb2dyYW0uYixcblx0XHRcdGQsXG5cdFx0XHRkdXJhdGlvbixcblx0XHRcdHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuXHRcdFx0ZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG5cdFx0XHRncm91cDogcHJvZ3JhbS5ncm91cFxuXHRcdH07XG5cdH1cblxuXHRmdW5jdGlvbiBnbyhiKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGNvbnN0IHByb2dyYW0gPSB7XG5cdFx0XHRzdGFydDogd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXksXG5cdFx0XHRiXG5cdFx0fTtcblxuXHRcdGlmICghYikge1xuXHRcdFx0cHJvZ3JhbS5ncm91cCA9IG91dHJvcztcblx0XHRcdG91dHJvcy5yZW1haW5pbmcgKz0gMTtcblx0XHR9XG5cblx0XHRpZiAocnVubmluZ19wcm9ncmFtKSB7XG5cdFx0XHRwZW5kaW5nX3Byb2dyYW0gPSBwcm9ncmFtO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQvLyBpZiB0aGlzIGlzIGFuIGludHJvLCBhbmQgdGhlcmUncyBhIGRlbGF5LCB3ZSBuZWVkIHRvIGRvXG5cdFx0XHQvLyBhbiBpbml0aWFsIHRpY2sgYW5kL29yIGFwcGx5IENTUyBhbmltYXRpb24gaW1tZWRpYXRlbHlcblx0XHRcdGlmIChjc3MpIHtcblx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChiKSB0aWNrJCQxKDAsIDEpO1xuXG5cdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBpbml0KHByb2dyYW0sIGR1cmF0aW9uKTtcblx0XHRcdGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgYiwgJ3N0YXJ0JykpO1xuXG5cdFx0XHRsb29wKG5vdyA9PiB7XG5cdFx0XHRcdGlmIChwZW5kaW5nX3Byb2dyYW0gJiYgbm93ID4gcGVuZGluZ19wcm9ncmFtLnN0YXJ0KSB7XG5cdFx0XHRcdFx0cnVubmluZ19wcm9ncmFtID0gaW5pdChwZW5kaW5nX3Byb2dyYW0sIGR1cmF0aW9uKTtcblx0XHRcdFx0XHRwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXG5cdFx0XHRcdFx0ZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdzdGFydCcpO1xuXG5cdFx0XHRcdFx0aWYgKGNzcykge1xuXHRcdFx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdFx0XHRhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIHQsIHJ1bm5pbmdfcHJvZ3JhbS5iLCBydW5uaW5nX3Byb2dyYW0uZHVyYXRpb24sIDAsIGVhc2luZywgY29uZmlnLmNzcyk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuXHRcdFx0XHRcdGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLmVuZCkge1xuXHRcdFx0XHRcdFx0dGljayQkMSh0ID0gcnVubmluZ19wcm9ncmFtLmIsIDEgLSB0KTtcblx0XHRcdFx0XHRcdGRpc3BhdGNoKG5vZGUsIHJ1bm5pbmdfcHJvZ3JhbS5iLCAnZW5kJyk7XG5cblx0XHRcdFx0XHRcdGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG5cdFx0XHRcdFx0XHRcdC8vIHdlJ3JlIGRvbmVcblx0XHRcdFx0XHRcdFx0aWYgKHJ1bm5pbmdfcHJvZ3JhbS5iKSB7XG5cdFx0XHRcdFx0XHRcdFx0Ly8gaW50cm8g4oCUIHdlIGNhbiB0aWR5IHVwIGltbWVkaWF0ZWx5XG5cdFx0XHRcdFx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0Ly8gb3V0cm8g4oCUIG5lZWRzIHRvIGJlIGNvb3JkaW5hdGVkXG5cdFx0XHRcdFx0XHRcdFx0aWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yZW1haW5pbmcpIHJ1bl9hbGwocnVubmluZ19wcm9ncmFtLmdyb3VwLmNhbGxiYWNrcyk7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdFx0cnVubmluZ19wcm9ncmFtID0gbnVsbDtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG5cdFx0XHRcdFx0XHRjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuXHRcdFx0XHRcdFx0dCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG5cdFx0XHRcdFx0XHR0aWNrJCQxKHQsIDEgLSB0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRyZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJ1bihiKSB7XG5cdFx0XHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHR3YWl0KCkudGhlbigoKSA9PiB7XG5cdFx0XHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRcdFx0Z28oYik7XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Z28oYik7XG5cdFx0XHR9XG5cdFx0fSxcblxuXHRcdGVuZCgpIHtcblx0XHRcdGNsZWFyX2FuaW1hdGlvbigpO1xuXHRcdFx0cnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcblx0Y29uc3QgdG9rZW4gPSBpbmZvLnRva2VuID0ge307XG5cblx0ZnVuY3Rpb24gdXBkYXRlKHR5cGUsIGluZGV4LCBrZXksIHZhbHVlKSB7XG5cdFx0aWYgKGluZm8udG9rZW4gIT09IHRva2VuKSByZXR1cm47XG5cblx0XHRpbmZvLnJlc29sdmVkID0ga2V5ICYmIHsgW2tleV06IHZhbHVlIH07XG5cblx0XHRjb25zdCBjaGlsZF9jdHggPSBhc3NpZ24oYXNzaWduKHt9LCBpbmZvLmN0eCksIGluZm8ucmVzb2x2ZWQpO1xuXHRcdGNvbnN0IGJsb2NrID0gdHlwZSAmJiAoaW5mby5jdXJyZW50ID0gdHlwZSkoY2hpbGRfY3R4KTtcblxuXHRcdGlmIChpbmZvLmJsb2NrKSB7XG5cdFx0XHRpZiAoaW5mby5ibG9ja3MpIHtcblx0XHRcdFx0aW5mby5ibG9ja3MuZm9yRWFjaCgoYmxvY2ssIGkpID0+IHtcblx0XHRcdFx0XHRpZiAoaSAhPT0gaW5kZXggJiYgYmxvY2spIHtcblx0XHRcdFx0XHRcdGdyb3VwX291dHJvcygpO1xuXHRcdFx0XHRcdFx0b25fb3V0cm8oKCkgPT4ge1xuXHRcdFx0XHRcdFx0XHRibG9jay5kKDEpO1xuXHRcdFx0XHRcdFx0XHRpbmZvLmJsb2Nrc1tpXSA9IG51bGw7XG5cdFx0XHRcdFx0XHR9KTtcblx0XHRcdFx0XHRcdGJsb2NrLm8oMSk7XG5cdFx0XHRcdFx0XHRjaGVja19vdXRyb3MoKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0aW5mby5ibG9jay5kKDEpO1xuXHRcdFx0fVxuXG5cdFx0XHRibG9jay5jKCk7XG5cdFx0XHRpZiAoYmxvY2suaSkgYmxvY2suaSgxKTtcblx0XHRcdGJsb2NrLm0oaW5mby5tb3VudCgpLCBpbmZvLmFuY2hvcik7XG5cblx0XHRcdGZsdXNoKCk7XG5cdFx0fVxuXG5cdFx0aW5mby5ibG9jayA9IGJsb2NrO1xuXHRcdGlmIChpbmZvLmJsb2NrcykgaW5mby5ibG9ja3NbaW5kZXhdID0gYmxvY2s7XG5cdH1cblxuXHRpZiAoaXNfcHJvbWlzZShwcm9taXNlKSkge1xuXHRcdHByb21pc2UudGhlbih2YWx1ZSA9PiB7XG5cdFx0XHR1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG5cdFx0fSwgZXJyb3IgPT4ge1xuXHRcdFx0dXBkYXRlKGluZm8uY2F0Y2gsIDIsIGluZm8uZXJyb3IsIGVycm9yKTtcblx0XHR9KTtcblxuXHRcdC8vIGlmIHdlIHByZXZpb3VzbHkgaGFkIGEgdGhlbi9jYXRjaCBibG9jaywgZGVzdHJveSBpdFxuXHRcdGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuXHRcdFx0dXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0aWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG5cdFx0XHR1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblxuXHRcdGluZm8ucmVzb2x2ZWQgPSB7IFtpbmZvLnZhbHVlXTogcHJvbWlzZSB9O1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRibG9jay5kKDEpO1xuXHRsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5cbmZ1bmN0aW9uIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcblx0b25fb3V0cm8oKCkgPT4ge1xuXHRcdGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG5cdH0pO1xuXG5cdGJsb2NrLm8oMSk7XG59XG5cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRibG9jay5mKCk7XG5cdG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVfa2V5ZWRfZWFjaChvbGRfYmxvY2tzLCBjaGFuZ2VkLCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG5cdGxldCBvID0gb2xkX2Jsb2Nrcy5sZW5ndGg7XG5cdGxldCBuID0gbGlzdC5sZW5ndGg7XG5cblx0bGV0IGkgPSBvO1xuXHRjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuXHR3aGlsZSAoaS0tKSBvbGRfaW5kZXhlc1tvbGRfYmxvY2tzW2ldLmtleV0gPSBpO1xuXG5cdGNvbnN0IG5ld19ibG9ja3MgPSBbXTtcblx0Y29uc3QgbmV3X2xvb2t1cCA9IG5ldyBNYXAoKTtcblx0Y29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuXG5cdGkgPSBuO1xuXHR3aGlsZSAoaS0tKSB7XG5cdFx0Y29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcblx0XHRjb25zdCBrZXkgPSBnZXRfa2V5KGNoaWxkX2N0eCk7XG5cdFx0bGV0IGJsb2NrID0gbG9va3VwLmdldChrZXkpO1xuXG5cdFx0aWYgKCFibG9jaykge1xuXHRcdFx0YmxvY2sgPSBjcmVhdGVfZWFjaF9ibG9jayhrZXksIGNoaWxkX2N0eCk7XG5cdFx0XHRibG9jay5jKCk7XG5cdFx0fSBlbHNlIGlmIChkeW5hbWljKSB7XG5cdFx0XHRibG9jay5wKGNoYW5nZWQsIGNoaWxkX2N0eCk7XG5cdFx0fVxuXG5cdFx0bmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuXG5cdFx0aWYgKGtleSBpbiBvbGRfaW5kZXhlcykgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG5cdH1cblxuXHRjb25zdCB3aWxsX21vdmUgPSBuZXcgU2V0KCk7XG5cdGNvbnN0IGRpZF9tb3ZlID0gbmV3IFNldCgpO1xuXG5cdGZ1bmN0aW9uIGluc2VydChibG9jaykge1xuXHRcdGlmIChibG9jay5pKSBibG9jay5pKDEpO1xuXHRcdGJsb2NrLm0obm9kZSwgbmV4dCk7XG5cdFx0bG9va3VwLnNldChibG9jay5rZXksIGJsb2NrKTtcblx0XHRuZXh0ID0gYmxvY2suZmlyc3Q7XG5cdFx0bi0tO1xuXHR9XG5cblx0d2hpbGUgKG8gJiYgbikge1xuXHRcdGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuXHRcdGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3NbbyAtIDFdO1xuXHRcdGNvbnN0IG5ld19rZXkgPSBuZXdfYmxvY2sua2V5O1xuXHRcdGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuXG5cdFx0aWYgKG5ld19ibG9jayA9PT0gb2xkX2Jsb2NrKSB7XG5cdFx0XHQvLyBkbyBub3RoaW5nXG5cdFx0XHRuZXh0ID0gbmV3X2Jsb2NrLmZpcnN0O1xuXHRcdFx0by0tO1xuXHRcdFx0bi0tO1xuXHRcdH1cblxuXHRcdGVsc2UgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfa2V5KSkge1xuXHRcdFx0Ly8gcmVtb3ZlIG9sZCBibG9ja1xuXHRcdFx0ZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG5cdFx0XHRvLS07XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoIWxvb2t1cC5oYXMobmV3X2tleSkgfHwgd2lsbF9tb3ZlLmhhcyhuZXdfa2V5KSkge1xuXHRcdFx0aW5zZXJ0KG5ld19ibG9jayk7XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoZGlkX21vdmUuaGFzKG9sZF9rZXkpKSB7XG5cdFx0XHRvLS07XG5cblx0XHR9IGVsc2UgaWYgKGRlbHRhcy5nZXQobmV3X2tleSkgPiBkZWx0YXMuZ2V0KG9sZF9rZXkpKSB7XG5cdFx0XHRkaWRfbW92ZS5hZGQobmV3X2tleSk7XG5cdFx0XHRpbnNlcnQobmV3X2Jsb2NrKTtcblxuXHRcdH0gZWxzZSB7XG5cdFx0XHR3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuXHRcdFx0by0tO1xuXHRcdH1cblx0fVxuXG5cdHdoaWxlIChvLS0pIHtcblx0XHRjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW29dO1xuXHRcdGlmICghbmV3X2xvb2t1cC5oYXMob2xkX2Jsb2NrLmtleSkpIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuXHR9XG5cblx0d2hpbGUgKG4pIGluc2VydChuZXdfYmxvY2tzW24gLSAxXSk7XG5cblx0cmV0dXJuIG5ld19ibG9ja3M7XG59XG5cbmZ1bmN0aW9uIG1lYXN1cmUoYmxvY2tzKSB7XG5cdGNvbnN0IHJlY3RzID0ge307XG5cdGxldCBpID0gYmxvY2tzLmxlbmd0aDtcblx0d2hpbGUgKGktLSkgcmVjdHNbYmxvY2tzW2ldLmtleV0gPSBibG9ja3NbaV0ubm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0cmV0dXJuIHJlY3RzO1xufVxuXG5mdW5jdGlvbiBnZXRfc3ByZWFkX3VwZGF0ZShsZXZlbHMsIHVwZGF0ZXMpIHtcblx0Y29uc3QgdXBkYXRlID0ge307XG5cblx0Y29uc3QgdG9fbnVsbF9vdXQgPSB7fTtcblx0Y29uc3QgYWNjb3VudGVkX2ZvciA9IHsgJCRzY29wZTogMSB9O1xuXG5cdGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcblx0d2hpbGUgKGktLSkge1xuXHRcdGNvbnN0IG8gPSBsZXZlbHNbaV07XG5cdFx0Y29uc3QgbiA9IHVwZGF0ZXNbaV07XG5cblx0XHRpZiAobikge1xuXHRcdFx0Zm9yIChjb25zdCBrZXkgaW4gbykge1xuXHRcdFx0XHRpZiAoIShrZXkgaW4gbikpIHRvX251bGxfb3V0W2tleV0gPSAxO1xuXHRcdFx0fVxuXG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG5cdFx0XHRcdGlmICghYWNjb3VudGVkX2ZvcltrZXldKSB7XG5cdFx0XHRcdFx0dXBkYXRlW2tleV0gPSBuW2tleV07XG5cdFx0XHRcdFx0YWNjb3VudGVkX2ZvcltrZXldID0gMTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRsZXZlbHNbaV0gPSBuO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG5cdFx0XHRcdGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0Zm9yIChjb25zdCBrZXkgaW4gdG9fbnVsbF9vdXQpIHtcblx0XHRpZiAoIShrZXkgaW4gdXBkYXRlKSkgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG5cdH1cblxuXHRyZXR1cm4gdXBkYXRlO1xufVxuXG5jb25zdCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3RlciA9IC9bXFxzJ1wiPi89XFx1e0ZERDB9LVxcdXtGREVGfVxcdXtGRkZFfVxcdXtGRkZGfVxcdXsxRkZGRX1cXHV7MUZGRkZ9XFx1ezJGRkZFfVxcdXsyRkZGRn1cXHV7M0ZGRkV9XFx1ezNGRkZGfVxcdXs0RkZGRX1cXHV7NEZGRkZ9XFx1ezVGRkZFfVxcdXs1RkZGRn1cXHV7NkZGRkV9XFx1ezZGRkZGfVxcdXs3RkZGRX1cXHV7N0ZGRkZ9XFx1ezhGRkZFfVxcdXs4RkZGRn1cXHV7OUZGRkV9XFx1ezlGRkZGfVxcdXtBRkZGRX1cXHV7QUZGRkZ9XFx1e0JGRkZFfVxcdXtCRkZGRn1cXHV7Q0ZGRkV9XFx1e0NGRkZGfVxcdXtERkZGRX1cXHV7REZGRkZ9XFx1e0VGRkZFfVxcdXtFRkZGRn1cXHV7RkZGRkV9XFx1e0ZGRkZGfVxcdXsxMEZGRkV9XFx1ezEwRkZGRn1dL3U7XG4vLyBodHRwczovL2h0bWwuc3BlYy53aGF0d2cub3JnL211bHRpcGFnZS9zeW50YXguaHRtbCNhdHRyaWJ1dGVzLTJcbi8vIGh0dHBzOi8vaW5mcmEuc3BlYy53aGF0d2cub3JnLyNub25jaGFyYWN0ZXJcblxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MpIHtcblx0Y29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuXHRsZXQgc3RyID0gJyc7XG5cblx0T2JqZWN0LmtleXMoYXR0cmlidXRlcykuZm9yRWFjaChuYW1lID0+IHtcblx0XHRpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSkgcmV0dXJuO1xuXG5cdFx0Y29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuXHRcdGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG5cdFx0aWYgKHZhbHVlID09PSB0cnVlKSBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuXG5cdFx0Y29uc3QgZXNjYXBlZCA9IFN0cmluZyh2YWx1ZSlcblx0XHRcdC5yZXBsYWNlKC9cIi9nLCAnJiMzNDsnKVxuXHRcdFx0LnJlcGxhY2UoLycvZywgJyYjMzk7Jyk7XG5cblx0XHRzdHIgKz0gXCIgXCIgKyBuYW1lICsgXCI9XCIgKyBKU09OLnN0cmluZ2lmeShlc2NhcGVkKTtcblx0fSk7XG5cblx0cmV0dXJuIHN0cjtcbn1cblxuY29uc3QgZXNjYXBlZCA9IHtcblx0J1wiJzogJyZxdW90OycsXG5cdFwiJ1wiOiAnJiMzOTsnLFxuXHQnJic6ICcmYW1wOycsXG5cdCc8JzogJyZsdDsnLFxuXHQnPic6ICcmZ3Q7J1xufTtcblxuZnVuY3Rpb24gZXNjYXBlKGh0bWwpIHtcblx0cmV0dXJuIFN0cmluZyhodG1sKS5yZXBsYWNlKC9bXCInJjw+XS9nLCBtYXRjaCA9PiBlc2NhcGVkW21hdGNoXSk7XG59XG5cbmZ1bmN0aW9uIGVhY2goaXRlbXMsIGZuKSB7XG5cdGxldCBzdHIgPSAnJztcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdHN0ciArPSBmbihpdGVtc1tpXSwgaSk7XG5cdH1cblx0cmV0dXJuIHN0cjtcbn1cblxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG5cdCQkcmVuZGVyOiAoKSA9PiAnJ1xufTtcblxuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuXHRpZiAoIWNvbXBvbmVudCB8fCAhY29tcG9uZW50LiQkcmVuZGVyKSB7XG5cdFx0aWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JykgbmFtZSArPSAnIHRoaXM9ey4uLn0nO1xuXHRcdHRocm93IG5ldyBFcnJvcihgPCR7bmFtZX0+IGlzIG5vdCBhIHZhbGlkIFNTUiBjb21wb25lbnQuIFlvdSBtYXkgbmVlZCB0byByZXZpZXcgeW91ciBidWlsZCBjb25maWcgdG8gZW5zdXJlIHRoYXQgZGVwZW5kZW5jaWVzIGFyZSBjb21waWxlZCwgcmF0aGVyIHRoYW4gaW1wb3J0ZWQgYXMgcHJlLWNvbXBpbGVkIG1vZHVsZXNgKTtcblx0fVxuXG5cdHJldHVybiBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGRlYnVnKGZpbGUsIGxpbmUsIGNvbHVtbiwgdmFsdWVzKSB7XG5cdGNvbnNvbGUubG9nKGB7QGRlYnVnfSAke2ZpbGUgPyBmaWxlICsgJyAnIDogJyd9KCR7bGluZX06JHtjb2x1bW59KWApOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdHJldHVybiAnJztcbn1cblxubGV0IG9uX2Rlc3Ryb3k7XG5cbmZ1bmN0aW9uIGNyZWF0ZV9zc3JfY29tcG9uZW50KGZuKSB7XG5cdGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuXHRcdGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblxuXHRcdGNvbnN0ICQkID0ge1xuXHRcdFx0b25fZGVzdHJveSxcblx0XHRcdGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcblxuXHRcdFx0Ly8gdGhlc2Ugd2lsbCBiZSBpbW1lZGlhdGVseSBkaXNjYXJkZWRcblx0XHRcdG9uX21vdW50OiBbXSxcblx0XHRcdGJlZm9yZV9yZW5kZXI6IFtdLFxuXHRcdFx0YWZ0ZXJfcmVuZGVyOiBbXSxcblx0XHRcdGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KClcblx0XHR9O1xuXG5cdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHsgJCQgfSk7XG5cblx0XHRjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcblxuXHRcdHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcblx0XHRyZXR1cm4gaHRtbDtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG5cdFx0XHRvbl9kZXN0cm95ID0gW107XG5cblx0XHRcdGNvbnN0IHJlc3VsdCA9IHsgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG5cdFx0XHRjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuXG5cdFx0XHRydW5fYWxsKG9uX2Rlc3Ryb3kpO1xuXG5cdFx0XHRyZXR1cm4ge1xuXHRcdFx0XHRodG1sLFxuXHRcdFx0XHRjc3M6IHtcblx0XHRcdFx0XHRjb2RlOiBBcnJheS5mcm9tKHJlc3VsdC5jc3MpLm1hcChjc3MgPT4gY3NzLmNvZGUpLmpvaW4oJ1xcbicpLFxuXHRcdFx0XHRcdG1hcDogbnVsbCAvLyBUT0RPXG5cdFx0XHRcdH0sXG5cdFx0XHRcdGhlYWQ6IHJlc3VsdC5oZWFkXG5cdFx0XHR9O1xuXHRcdH0sXG5cblx0XHQkJHJlbmRlclxuXHR9O1xufVxuXG5mdW5jdGlvbiBnZXRfc3RvcmVfdmFsdWUoc3RvcmUpIHtcblx0bGV0IHZhbHVlO1xuXHRzdG9yZS5zdWJzY3JpYmUoXyA9PiB2YWx1ZSA9IF8pKCk7XG5cdHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG5cdGlmIChjb21wb25lbnQuJCQucHJvcHMuaW5kZXhPZihuYW1lKSA9PT0gLTEpIHJldHVybjtcblx0Y29tcG9uZW50LiQkLmJvdW5kW25hbWVdID0gY2FsbGJhY2s7XG5cdGNhbGxiYWNrKGNvbXBvbmVudC4kJC5jdHhbbmFtZV0pO1xufVxuXG5mdW5jdGlvbiBtb3VudF9jb21wb25lbnQoY29tcG9uZW50LCB0YXJnZXQsIGFuY2hvcikge1xuXHRjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfcmVuZGVyIH0gPSBjb21wb25lbnQuJCQ7XG5cblx0ZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG5cblx0Ly8gb25Nb3VudCBoYXBwZW5zIGFmdGVyIHRoZSBpbml0aWFsIGFmdGVyVXBkYXRlLiBCZWNhdXNlXG5cdC8vIGFmdGVyVXBkYXRlIGNhbGxiYWNrcyBoYXBwZW4gaW4gcmV2ZXJzZSBvcmRlciAoaW5uZXIgZmlyc3QpXG5cdC8vIHdlIHNjaGVkdWxlIG9uTW91bnQgY2FsbGJhY2tzIGJlZm9yZSBhZnRlclVwZGF0ZSBjYWxsYmFja3Ncblx0YWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiB7XG5cdFx0Y29uc3QgbmV3X29uX2Rlc3Ryb3kgPSBvbl9tb3VudC5tYXAocnVuKS5maWx0ZXIoaXNfZnVuY3Rpb24pO1xuXHRcdGlmIChvbl9kZXN0cm95KSB7XG5cdFx0XHRvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQvLyBFZGdlIGNhc2UgLSBjb21wb25lbnQgd2FzIGRlc3Ryb3llZCBpbW1lZGlhdGVseSxcblx0XHRcdC8vIG1vc3QgbGlrZWx5IGFzIGEgcmVzdWx0IG9mIGEgYmluZGluZyBpbml0aWFsaXNpbmdcblx0XHRcdHJ1bl9hbGwobmV3X29uX2Rlc3Ryb3kpO1xuXHRcdH1cblx0XHRjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcblx0fSk7XG5cblx0YWZ0ZXJfcmVuZGVyLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3koY29tcG9uZW50LCBkZXRhY2hpbmcpIHtcblx0aWYgKGNvbXBvbmVudC4kJCkge1xuXHRcdHJ1bl9hbGwoY29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kpO1xuXHRcdGNvbXBvbmVudC4kJC5mcmFnbWVudC5kKGRldGFjaGluZyk7XG5cblx0XHQvLyBUT0RPIG51bGwgb3V0IG90aGVyIHJlZnMsIGluY2x1ZGluZyBjb21wb25lbnQuJCQgKGJ1dCBuZWVkIHRvXG5cdFx0Ly8gcHJlc2VydmUgZmluYWwgc3RhdGU/KVxuXHRcdGNvbXBvbmVudC4kJC5vbl9kZXN0cm95ID0gY29tcG9uZW50LiQkLmZyYWdtZW50ID0gbnVsbDtcblx0XHRjb21wb25lbnQuJCQuY3R4ID0ge307XG5cdH1cbn1cblxuZnVuY3Rpb24gbWFrZV9kaXJ0eShjb21wb25lbnQsIGtleSkge1xuXHRpZiAoIWNvbXBvbmVudC4kJC5kaXJ0eSkge1xuXHRcdGRpcnR5X2NvbXBvbmVudHMucHVzaChjb21wb25lbnQpO1xuXHRcdHNjaGVkdWxlX3VwZGF0ZSgpO1xuXHRcdGNvbXBvbmVudC4kJC5kaXJ0eSA9IGJsYW5rX29iamVjdCgpO1xuXHR9XG5cdGNvbXBvbmVudC4kJC5kaXJ0eVtrZXldID0gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCQkMSwgcHJvcF9uYW1lcykge1xuXHRjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG5cdHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuXG5cdGNvbnN0IHByb3BzID0gb3B0aW9ucy5wcm9wcyB8fCB7fTtcblxuXHRjb25zdCAkJCA9IGNvbXBvbmVudC4kJCA9IHtcblx0XHRmcmFnbWVudDogbnVsbCxcblx0XHRjdHg6IG51bGwsXG5cblx0XHQvLyBzdGF0ZVxuXHRcdHByb3BzOiBwcm9wX25hbWVzLFxuXHRcdHVwZGF0ZTogbm9vcCxcblx0XHRub3RfZXF1YWw6IG5vdF9lcXVhbCQkMSxcblx0XHRib3VuZDogYmxhbmtfb2JqZWN0KCksXG5cblx0XHQvLyBsaWZlY3ljbGVcblx0XHRvbl9tb3VudDogW10sXG5cdFx0b25fZGVzdHJveTogW10sXG5cdFx0YmVmb3JlX3JlbmRlcjogW10sXG5cdFx0YWZ0ZXJfcmVuZGVyOiBbXSxcblx0XHRjb250ZXh0OiBuZXcgTWFwKHBhcmVudF9jb21wb25lbnQgPyBwYXJlbnRfY29tcG9uZW50LiQkLmNvbnRleHQgOiBbXSksXG5cblx0XHQvLyBldmVyeXRoaW5nIGVsc2Vcblx0XHRjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpLFxuXHRcdGRpcnR5OiBudWxsXG5cdH07XG5cblx0bGV0IHJlYWR5ID0gZmFsc2U7XG5cblx0JCQuY3R4ID0gaW5zdGFuY2Vcblx0XHQ/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcHMsIChrZXksIHZhbHVlKSA9PiB7XG5cdFx0XHRpZiAoJCQuY3R4ICYmIG5vdF9lcXVhbCQkMSgkJC5jdHhba2V5XSwgJCQuY3R4W2tleV0gPSB2YWx1ZSkpIHtcblx0XHRcdFx0aWYgKCQkLmJvdW5kW2tleV0pICQkLmJvdW5kW2tleV0odmFsdWUpO1xuXHRcdFx0XHRpZiAocmVhZHkpIG1ha2VfZGlydHkoY29tcG9uZW50LCBrZXkpO1xuXHRcdFx0fVxuXHRcdH0pXG5cdFx0OiBwcm9wcztcblxuXHQkJC51cGRhdGUoKTtcblx0cmVhZHkgPSB0cnVlO1xuXHRydW5fYWxsKCQkLmJlZm9yZV9yZW5kZXIpO1xuXHQkJC5mcmFnbWVudCA9IGNyZWF0ZV9mcmFnbWVudCgkJC5jdHgpO1xuXG5cdGlmIChvcHRpb25zLnRhcmdldCkge1xuXHRcdGlmIChvcHRpb25zLmh5ZHJhdGUpIHtcblx0XHRcdCQkLmZyYWdtZW50LmwoY2hpbGRyZW4ob3B0aW9ucy50YXJnZXQpKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0JCQuZnJhZ21lbnQuYygpO1xuXHRcdH1cblxuXHRcdGlmIChvcHRpb25zLmludHJvICYmIGNvbXBvbmVudC4kJC5mcmFnbWVudC5pKSBjb21wb25lbnQuJCQuZnJhZ21lbnQuaSgpO1xuXHRcdG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG5cdFx0Zmx1c2goKTtcblx0fVxuXG5cdHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cblxubGV0IFN2ZWx0ZUVsZW1lbnQ7XG5pZiAodHlwZW9mIEhUTUxFbGVtZW50ICE9PSAndW5kZWZpbmVkJykge1xuXHRTdmVsdGVFbGVtZW50ID0gY2xhc3MgZXh0ZW5kcyBIVE1MRWxlbWVudCB7XG5cdFx0Y29uc3RydWN0b3IoKSB7XG5cdFx0XHRzdXBlcigpO1xuXHRcdFx0dGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG5cdFx0fVxuXG5cdFx0Y29ubmVjdGVkQ2FsbGJhY2soKSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiB0aGlzLiQkLnNsb3R0ZWQpIHtcblx0XHRcdFx0dGhpcy5hcHBlbmRDaGlsZCh0aGlzLiQkLnNsb3R0ZWRba2V5XSk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0YXR0cmlidXRlQ2hhbmdlZENhbGxiYWNrKGF0dHIkJDEsIG9sZFZhbHVlLCBuZXdWYWx1ZSkge1xuXHRcdFx0dGhpc1thdHRyJCQxXSA9IG5ld1ZhbHVlO1xuXHRcdH1cblxuXHRcdCRkZXN0cm95KCkge1xuXHRcdFx0ZGVzdHJveSh0aGlzLCB0cnVlKTtcblx0XHRcdHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuXHRcdH1cblxuXHRcdCRvbih0eXBlLCBjYWxsYmFjaykge1xuXHRcdFx0Ly8gVE9ETyBzaG91bGQgdGhpcyBkZWxlZ2F0ZSB0byBhZGRFdmVudExpc3RlbmVyP1xuXHRcdFx0Y29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG5cdFx0XHRjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG5cblx0XHRcdHJldHVybiAoKSA9PiB7XG5cdFx0XHRcdGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuXHRcdFx0XHRpZiAoaW5kZXggIT09IC0xKSBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0JHNldCgpIHtcblx0XHRcdC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuXHRcdH1cblx0fTtcbn1cblxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50IHtcblx0JGRlc3Ryb3koKSB7XG5cdFx0ZGVzdHJveSh0aGlzLCB0cnVlKTtcblx0XHR0aGlzLiRkZXN0cm95ID0gbm9vcDtcblx0fVxuXG5cdCRvbih0eXBlLCBjYWxsYmFjaykge1xuXHRcdGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuXHRcdGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcblxuXHRcdHJldHVybiAoKSA9PiB7XG5cdFx0XHRjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcblx0XHRcdGlmIChpbmRleCAhPT0gLTEpIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdH07XG5cdH1cblxuXHQkc2V0KCkge1xuXHRcdC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuXHR9XG59XG5cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudERldiBleHRlbmRzIFN2ZWx0ZUNvbXBvbmVudCB7XG5cdGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcblx0XHRpZiAoIW9wdGlvbnMgfHwgKCFvcHRpb25zLnRhcmdldCAmJiAhb3B0aW9ucy4kJGlubGluZSkpIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcihgJ3RhcmdldCcgaXMgYSByZXF1aXJlZCBvcHRpb25gKTtcblx0XHR9XG5cblx0XHRzdXBlcigpO1xuXHR9XG5cblx0JGRlc3Ryb3koKSB7XG5cdFx0c3VwZXIuJGRlc3Ryb3koKTtcblx0XHR0aGlzLiRkZXN0cm95ID0gKCkgPT4ge1xuXHRcdFx0Y29uc29sZS53YXJuKGBDb21wb25lbnQgd2FzIGFscmVhZHkgZGVzdHJveWVkYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRcdH07XG5cdH1cbn1cblxuZXhwb3J0IHsgY3JlYXRlX2FuaW1hdGlvbiwgZml4X3Bvc2l0aW9uLCBoYW5kbGVfcHJvbWlzZSwgYXBwZW5kLCBpbnNlcnQsIGRldGFjaCwgZGV0YWNoX2JldHdlZW4sIGRldGFjaF9iZWZvcmUsIGRldGFjaF9hZnRlciwgZGVzdHJveV9lYWNoLCBlbGVtZW50LCBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzLCBzdmdfZWxlbWVudCwgdGV4dCwgc3BhY2UsIGVtcHR5LCBsaXN0ZW4sIHByZXZlbnRfZGVmYXVsdCwgc3RvcF9wcm9wYWdhdGlvbiwgYXR0ciwgc2V0X2F0dHJpYnV0ZXMsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCB4bGlua19hdHRyLCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgdG9fbnVtYmVyLCB0aW1lX3Jhbmdlc190b19hcnJheSwgY2hpbGRyZW4sIGNsYWltX2VsZW1lbnQsIGNsYWltX3RleHQsIHNldF9kYXRhLCBzZXRfaW5wdXRfdHlwZSwgc2V0X3N0eWxlLCBzZWxlY3Rfb3B0aW9uLCBzZWxlY3Rfb3B0aW9ucywgc2VsZWN0X3ZhbHVlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIGFkZF9yZXNpemVfbGlzdGVuZXIsIHRvZ2dsZV9jbGFzcywgY3VzdG9tX2V2ZW50LCBkZXN0cm95X2Jsb2NrLCBvdXRyb19hbmRfZGVzdHJveV9ibG9jaywgZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jaywgdXBkYXRlX2tleWVkX2VhY2gsIG1lYXN1cmUsIGN1cnJlbnRfY29tcG9uZW50LCBzZXRfY3VycmVudF9jb21wb25lbnQsIGJlZm9yZVVwZGF0ZSwgb25Nb3VudCwgYWZ0ZXJVcGRhdGUsIG9uRGVzdHJveSwgY3JlYXRlRXZlbnREaXNwYXRjaGVyLCBzZXRDb250ZXh0LCBnZXRDb250ZXh0LCBidWJibGUsIGNsZWFyX2xvb3BzLCBsb29wLCBkaXJ0eV9jb21wb25lbnRzLCBpbnRyb3MsIHNjaGVkdWxlX3VwZGF0ZSwgdGljaywgYWRkX2JpbmRpbmdfY2FsbGJhY2ssIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9mbHVzaF9jYWxsYmFjaywgZmx1c2gsIGdldF9zcHJlYWRfdXBkYXRlLCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlciwgc3ByZWFkLCBlc2NhcGVkLCBlc2NhcGUsIGVhY2gsIG1pc3NpbmdfY29tcG9uZW50LCB2YWxpZGF0ZV9jb21wb25lbnQsIGRlYnVnLCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgZ2V0X3N0b3JlX3ZhbHVlLCBncm91cF9vdXRyb3MsIGNoZWNrX291dHJvcywgb25fb3V0cm8sIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIG5vb3AsIGlkZW50aXR5LCBhc3NpZ24sIGlzX3Byb21pc2UsIGFkZF9sb2NhdGlvbiwgcnVuLCBibGFua19vYmplY3QsIHJ1bl9hbGwsIGlzX2Z1bmN0aW9uLCBzYWZlX25vdF9lcXVhbCwgbm90X2VxdWFsLCB2YWxpZGF0ZV9zdG9yZSwgc3Vic2NyaWJlLCBjcmVhdGVfc2xvdCwgZ2V0X3Nsb3RfY29udGV4dCwgZ2V0X3Nsb3RfY2hhbmdlcywgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgYmluZCwgbW91bnRfY29tcG9uZW50LCBpbml0LCBTdmVsdGVFbGVtZW50LCBTdmVsdGVDb21wb25lbnQsIFN2ZWx0ZUNvbXBvbmVudERldiB9O1xuIiwiZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdE1vbmV5KHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZS50b1N0cmluZygpLnJlcGxhY2UoL1xcQig/PShcXGR7M30pKyg/IVxcZCkpL2csICcsJyk7XG59XG4iLCJpbXBvcnQgeyBydW5fYWxsLCBub29wLCBnZXRfc3RvcmVfdmFsdWUsIHNhZmVfbm90X2VxdWFsIH0gZnJvbSAnLi9pbnRlcm5hbCc7XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkYWJsZSh2YWx1ZSwgc3RhcnQpIHtcblx0cmV0dXJuIHtcblx0XHRzdWJzY3JpYmU6IHdyaXRhYmxlKHZhbHVlLCBzdGFydCkuc3Vic2NyaWJlXG5cdH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0YWJsZSh2YWx1ZSwgc3RhcnQgPSBub29wKSB7XG5cdGxldCBzdG9wO1xuXHRjb25zdCBzdWJzY3JpYmVycyA9IFtdO1xuXG5cdGZ1bmN0aW9uIHNldChuZXdfdmFsdWUpIHtcblx0XHRpZiAoc2FmZV9ub3RfZXF1YWwodmFsdWUsIG5ld192YWx1ZSkpIHtcblx0XHRcdHZhbHVlID0gbmV3X3ZhbHVlO1xuXHRcdFx0aWYgKCFzdG9wKSByZXR1cm47IC8vIG5vdCByZWFkeVxuXHRcdFx0c3Vic2NyaWJlcnMuZm9yRWFjaChzID0+IHNbMV0oKSk7XG5cdFx0XHRzdWJzY3JpYmVycy5mb3JFYWNoKHMgPT4gc1swXSh2YWx1ZSkpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIHVwZGF0ZShmbikge1xuXHRcdHNldChmbih2YWx1ZSkpO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3Vic2NyaWJlKHJ1biwgaW52YWxpZGF0ZSA9IG5vb3ApIHtcblx0XHRjb25zdCBzdWJzY3JpYmVyID0gW3J1biwgaW52YWxpZGF0ZV07XG5cdFx0c3Vic2NyaWJlcnMucHVzaChzdWJzY3JpYmVyKTtcblx0XHRpZiAoc3Vic2NyaWJlcnMubGVuZ3RoID09PSAxKSBzdG9wID0gc3RhcnQoc2V0KSB8fCBub29wO1xuXHRcdHJ1bih2YWx1ZSk7XG5cblx0XHRyZXR1cm4gKCkgPT4ge1xuXHRcdFx0Y29uc3QgaW5kZXggPSBzdWJzY3JpYmVycy5pbmRleE9mKHN1YnNjcmliZXIpO1xuXHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgc3Vic2NyaWJlcnMuc3BsaWNlKGluZGV4LCAxKTtcblx0XHRcdGlmIChzdWJzY3JpYmVycy5sZW5ndGggPT09IDApIHN0b3AoKTtcblx0XHR9O1xuXHR9XG5cblx0cmV0dXJuIHsgc2V0LCB1cGRhdGUsIHN1YnNjcmliZSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlZChzdG9yZXMsIGZuLCBpbml0aWFsX3ZhbHVlKSB7XG5cdGNvbnN0IHNpbmdsZSA9ICFBcnJheS5pc0FycmF5KHN0b3Jlcyk7XG5cdGlmIChzaW5nbGUpIHN0b3JlcyA9IFtzdG9yZXNdO1xuXG5cdGNvbnN0IGF1dG8gPSBmbi5sZW5ndGggPCAyO1xuXHRsZXQgdmFsdWUgPSB7fTtcblxuXHRyZXR1cm4gcmVhZGFibGUoaW5pdGlhbF92YWx1ZSwgc2V0ID0+IHtcblx0XHRsZXQgaW5pdGVkID0gZmFsc2U7XG5cdFx0Y29uc3QgdmFsdWVzID0gW107XG5cblx0XHRsZXQgcGVuZGluZyA9IDA7XG5cdFx0bGV0IGNsZWFudXAgPSBub29wO1xuXG5cdFx0Y29uc3Qgc3luYyA9ICgpID0+IHtcblx0XHRcdGlmIChwZW5kaW5nKSByZXR1cm47XG5cdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRjb25zdCByZXN1bHQgPSBmbihzaW5nbGUgPyB2YWx1ZXNbMF0gOiB2YWx1ZXMsIHNldCk7XG5cdFx0XHRpZiAoYXV0bykgc2V0KHJlc3VsdCk7XG5cdFx0XHRlbHNlIGNsZWFudXAgPSByZXN1bHQgfHwgbm9vcDtcblx0XHR9O1xuXG5cdFx0Y29uc3QgdW5zdWJzY3JpYmVycyA9IHN0b3Jlcy5tYXAoKHN0b3JlLCBpKSA9PiBzdG9yZS5zdWJzY3JpYmUoXG5cdFx0XHR2YWx1ZSA9PiB7XG5cdFx0XHRcdHZhbHVlc1tpXSA9IHZhbHVlO1xuXHRcdFx0XHRwZW5kaW5nICY9IH4oMSA8PCBpKTtcblx0XHRcdFx0aWYgKGluaXRlZCkgc3luYygpO1xuXHRcdFx0fSxcblx0XHRcdCgpID0+IHtcblx0XHRcdFx0cGVuZGluZyB8PSAoMSA8PCBpKTtcblx0XHRcdH0pXG5cdFx0KTtcblxuXHRcdGluaXRlZCA9IHRydWU7XG5cdFx0c3luYygpO1xuXG5cdFx0cmV0dXJuIGZ1bmN0aW9uIHN0b3AoKSB7XG5cdFx0XHRydW5fYWxsKHVuc3Vic2NyaWJlcnMpO1xuXHRcdFx0Y2xlYW51cCgpO1xuXHRcdH07XG5cdH0pO1xufVxuXG5leHBvcnQgeyBnZXRfc3RvcmVfdmFsdWUgYXMgZ2V0IH07XG4iLCJpbXBvcnQgeyB3cml0YWJsZSB9IGZyb20gJ3N2ZWx0ZS9zdG9yZSc7XG5cbmV4cG9ydCBjb25zdCBjYXJ0ID0gd3JpdGFibGUoe1xuICBpdGVtczogW10sXG4gIHN0YXR1czogJ2lkbGUnLFxufSk7XG5cbmxldCBza2lwO1xuXG5jYXJ0LnN1YnNjcmliZShkYXRhID0+IHtcbiAgaWYgKCFza2lwICYmIGRhdGEuc3RhdHVzICE9PSAnaWRsZScpIHtcbiAgICB3aW5kb3cubG9jYWxTdG9yYWdlLmNhcnQkID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gIH1cbn0pO1xuXG5pZiAod2luZG93LmxvY2FsU3RvcmFnZS5jYXJ0JCkge1xuICBza2lwID0gdHJ1ZTtcbiAgY2FydC51cGRhdGUoKCkgPT4gKHtcbiAgICAuLi5KU09OLnBhcnNlKHdpbmRvdy5sb2NhbFN0b3JhZ2UuY2FydCQpLFxuICAgIHN0YXR1czogJ2xvYWRlZCcsXG4gIH0pKTtcbiAgc2tpcCA9IGZhbHNlO1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gIGNhcnQsXG59O1xuIiwiPHNjcmlwdD5cbiAgaW1wb3J0IHsgY3JlYXRlRXZlbnREaXNwYXRjaGVyIH0gZnJvbSAnc3ZlbHRlJztcblxuICBleHBvcnQgbGV0IHZhbHVlID0gMDtcblxuICBjb25zdCBkaXNwYXRjaCA9IGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpO1xuXG4gIGxldCByZWY7XG5cbiAgZnVuY3Rpb24gc3luYygpIHtcbiAgICBkaXNwYXRjaCgnY2hhbmdlJywgcmVmKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluYygpIHtcbiAgICByZWYudmFsdWUgPSBwYXJzZUZsb2F0KHJlZi52YWx1ZSkgKyAxO1xuICAgIHN5bmMoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRlYygpIHtcbiAgICBpZiAocmVmLnZhbHVlIDw9IHJlZi5nZXRBdHRyaWJ1dGUoJ21pbicpKSByZXR1cm47XG4gICAgcmVmLnZhbHVlID0gcGFyc2VGbG9hdChyZWYudmFsdWUpIC0gMTtcbiAgICBzeW5jKCk7XG4gIH1cbjwvc2NyaXB0PlxuXG48c3R5bGU+XG4gIHNwYW4ge1xuICAgIGRpc3BsYXk6IGZsZXg7XG4gIH1cblxuICBpbnB1dCB7XG4gICAgd2lkdGg6IDYwcHggIWltcG9ydGFudDtcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgIHotaW5kZXg6IDI7XG4gIH1cblxuICBidXR0b24ge1xuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgICB6LWluZGV4OiAxO1xuICB9XG48L3N0eWxlPlxuXG48c3Bhbj5cbiAgPGJ1dHRvbiBjbGFzcz1cIm5vc2xcIiBvbjpjbGljaz17ZGVjfT4tPC9idXR0b24+XG4gIDxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMVwiIGJpbmQ6dGhpcz17cmVmfSBiaW5kOnZhbHVlIG9uOmNoYW5nZT17c3luY30gLz5cbiAgPGJ1dHRvbiBjbGFzcz1cIm5vc2xcIiBvbjpjbGljaz17aW5jfT4rPC9idXR0b24+XG48L3NwYW4+XG4iLCI8c2NyaXB0PlxuICBleHBvcnQgbGV0IHR5cGUgPSAndGV4dCc7XG4gIGV4cG9ydCBsZXQgbXNnID0gJ1BvciBmYXZvciBjb21wbGV0YSDDqXN0ZSBjYW1wbyc7XG5cbiAgbGV0IHNhdmVkRGF0YSA9IHt9O1xuXG4gIGlmICh3aW5kb3cubG9jYWxTdG9yYWdlLmlucHV0JCkge1xuICAgIHNhdmVkRGF0YSA9IEpTT04ucGFyc2Uod2luZG93LmxvY2FsU3RvcmFnZS5pbnB1dCQpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2hlY2soZSkge1xuICAgIGUudGFyZ2V0LnNldEN1c3RvbVZhbGlkaXR5KCcnKTtcblxuICAgIGlmICghZS50YXJnZXQudmFsaWRpdHkudmFsaWQpIHtcbiAgICAgIGUudGFyZ2V0LnNldEN1c3RvbVZhbGlkaXR5KG1zZyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmVzZXQoZSkge1xuICAgIGUudGFyZ2V0LnNldEN1c3RvbVZhbGlkaXR5KCcnKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHVwZGF0ZShlKSB7XG4gICAgc2F2ZWREYXRhWyQkcHJvcHMubmFtZV0gPSBlLnRhcmdldC52YWx1ZTtcbiAgICB3aW5kb3cubG9jYWxTdG9yYWdlLmlucHV0JCA9IEpTT04uc3RyaW5naWZ5KHNhdmVkRGF0YSk7XG4gIH1cblxuICAkOiBmaXhlZFByb3BzID0geyAuLi4kJHByb3BzLCB2YWx1ZTogJCRwcm9wcy52YWx1ZSB8fCBzYXZlZERhdGFbJCRwcm9wcy5uYW1lXSB8fCAnJywgbXNnOiB1bmRlZmluZWQsIHR5cGU6IHVuZGVmaW5lZCB9O1xuPC9zY3JpcHQ+XG5cbnsjaWYgdHlwZSA9PT0gJ3RleHRhcmVhJ31cbiAgPHRleHRhcmVhIG9uOmludmFsaWQ9e2NoZWNrfSBvbjppbnB1dD17cmVzZXR9IG9uOmJsdXI9e3VwZGF0ZX0gey4uLmZpeGVkUHJvcHN9IC8+XG57OmVsc2V9XG4gIDxpbnB1dCBvbjppbnZhbGlkPXtjaGVja30gb246aW5wdXQ9e3Jlc2V0fSBvbjpibHVyPXt1cGRhdGV9IHsuLi5maXhlZFByb3BzfSB7dHlwZX0gLz5cbnsvaWZ9XG4iLCI8c2NyaXB0PlxuICBpbXBvcnQgeyBmb3JtYXRNb25leSB9IGZyb20gJy4uL3NoYXJlZC9oZWxwZXJzJztcbiAgaW1wb3J0IHsgY2FydCB9IGZyb20gJy4uL3NoYXJlZC9zdG9yZXMnO1xuICBpbXBvcnQgTnVtIGZyb20gJy4vTnVtYmVyLnN2ZWx0ZSc7XG4gIGltcG9ydCBJbiBmcm9tICcuL0lucHV0LnN2ZWx0ZSc7XG5cbiAgY29uc3QgcHJvZHVjdHMgPSB3aW5kb3cucHJvZHVjdHMkIHx8IHt9O1xuXG4gIHZhciBGT1JNU1BSRUVfQVBJX0NPREU9XCJ4ZG93cnZqclwiO1xuXG4gIGxldCBkb25lID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gY2xvc2UoKSB7XG4gICAgZG9uZSA9IGZhbHNlO1xuICB9XG5cbiAgZnVuY3Rpb24gc3luYygpIHtcbiAgICBpZiAod2luZG93LmNhcnRTeW5jKSB7XG4gICAgICB3aW5kb3cuY2FydFN5bmMoJGNhcnQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNlbmQoZSwgZGF0YSkge1xuICAgIGNvbnN0IHsgZWxlbWVudHMsIG1ldGhvZCwgYWN0aW9uIH0gPSBlLnRhcmdldDtcblxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBlbWFpbGFkZHI6IGVsZW1lbnRzLmVtYWlsYWRkci52YWx1ZSxcbiAgICAgIGZ1bGxhZGRyOiBlbGVtZW50cy5mdWxsYWRkci52YWx1ZSxcbiAgICAgIGZ1bGxuYW1lOiBlbGVtZW50cy5mdWxsbmFtZS52YWx1ZSxcbiAgICAgIHBob25lbnVtOiBlbGVtZW50cy5waG9uZW51bS52YWx1ZSxcbiAgICAgIHByb2R1Y3RzOiBkYXRhLm1hcCh4ID0+ICh7XG4gICAgICAgIHF0eTogeC5xdHksXG4gICAgICAgIG5hbWU6IHgubmFtZSxcbiAgICAgICAgY29zdDogeC52YWx1ZSxcbiAgICAgICAgdG90YWw6IHgudG90YWwsXG4gICAgICAgIGRldGFpbDogeC5sYWJlbCxcbiAgICAgIH0pKSxcbiAgICB9O1xuXG4gICAgJGNhcnQuaXRlbXMgPSBbXTtcbiAgICBkb25lID0gdHJ1ZTtcbiAgICBzeW5jKCk7XG5cbiAgICBmZXRjaChhY3Rpb24sIHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gc2V0KGUsIGl0ZW0pIHtcbiAgICBjb25zdCB0YXJnZXQgPSAkY2FydC5pdGVtcy5maW5kKHggPT4geC5pZCA9PT0gaXRlbS5pZCk7XG5cbiAgICB0YXJnZXQucXR5ID0gcGFyc2VGbG9hdChlLmRldGFpbC52YWx1ZSk7XG4gICAgJGNhcnQuc3RhdHVzID0gJ3VwZGF0ZWQnO1xuICAgIHN5bmMoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJtKGl0ZW0pIHtcbiAgICBpZiAoIWNvbmZpcm0oJ8K/RXN0w6FzIHNlZ3Vybz8nKSkgcmV0dXJuO1xuICAgICRjYXJ0Lml0ZW1zID0gJGNhcnQuaXRlbXMuZmlsdGVyKHggPT4geC5pZCAhPT0gaXRlbS5pZCk7XG4gICAgJGNhcnQuc3RhdHVzID0gJ3JlbW92ZWQnO1xuICAgIHN5bmMoKTtcbiAgfVxuXG4gICQ6IGZpeGVkQ2FydCA9ICRjYXJ0Lml0ZW1zLm1hcCh4ID0+ICh7XG4gICAgLi4ueCxcbiAgICAuLi5wcm9kdWN0c1t4LmtleV0sXG4gICAgdG90YWw6IHgudmFsdWUgKiB4LnF0eSxcbiAgfSkpO1xuPC9zY3JpcHQ+XG5cbnsjaWYgZG9uZX1cbiAgPGRpdiBjbGFzcz1cImZpeGVkIG92ZXJsYXlcIj5cbiAgICA8ZGl2IGNsYXNzPVwibm9zbFwiPlxuICAgICAgPGgyIGNsYXNzPVwiYmlnZ2VzdFwiPk1VQ0hBUyBHUkFDSUFTPC9oMj5cbiAgICAgIDxwPlR1IHBlZGlkbyBoYSBzaWRvIHJlY2liaWRvLCBub3MgY29tdW5pY2FyZW1vcyBjb250aWdvIGEgbGEgYnJldmVkYWQuPC9wPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInNvbGlkLXNoYWRvd1wiIG9uOmNsaWNrPXtjbG9zZX0+Q0VSUkFSPC9idXR0b24+XG4gICAgPC9kaXY+XG4gIDwvZGl2Plxuey9pZn1cblxuPGgxIGNsYXNzPVwibm9zbCBiaWdnZXN0XCI+U0hPUFBJTkcgTElTVDwvaDE+XG48ZGl2IGNsYXNzPVwibWQtZmxleFwiPlxuICA8dWwgY2xhc3M9XCJyZXNldFwiPlxuICAgIHsjZWFjaCBmaXhlZENhcnQgYXMgaXRlbSAoaXRlbS5pZCl9XG4gICAgICA8bGkgY2xhc3M9XCJmbGV4XCI+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJvdmVybGF5XCI+XG4gICAgICAgICAgPE51bSB2YWx1ZT17aXRlbS5xdHl9IG9uOmNoYW5nZT17ZSA9PiBzZXQoZSwgaXRlbSl9IC8+XG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm5vc2wgc29saWQtc2hhZG93XCIgb246Y2xpY2s9eygpID0+IHJtKGl0ZW0pfT5FbGltaW5hcjwvYnV0dG9uPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGZpZ3VyZT5cbiAgICAgICAgICA8aW1nIGNsYXNzPVwibm9zbFwiIGFsdD17aXRlbS5uYW1lfSBzcmM9e2l0ZW0uaW1hZ2V9Lz5cbiAgICAgICAgICA8ZmlnY2FwdGlvbiBjbGFzcz1cImZsZXggYXJvdW5kXCI+XG4gICAgICAgICAgICA8ZGl2PlxuICAgICAgICAgICAgICA8aDIgY2xhc3M9XCJmLTEwMFwiPntpdGVtLm5hbWV9PC9oMj5cbiAgICAgICAgICAgICAge2l0ZW0ubGFiZWx9IHgge2l0ZW0ucXR5fVxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8YiBjbGFzcz1cImJpZ2dlclwiPiR7Zm9ybWF0TW9uZXkoaXRlbS52YWx1ZSAqIGl0ZW0ucXR5KX08L2I+XG4gICAgICAgICAgPC9maWdjYXB0aW9uPlxuICAgICAgICA8L2ZpZ3VyZT5cbiAgICAgIDwvbGk+XG4gICAgezplbHNlfVxuICAgICAgPGxpIGNsYXNzPVwid2lwIG5vc2xcIj5cbiAgICAgICAgPGgyPk5vIGl0ZW1zIGluIHlvdXIgYmFza2V0Li4uPC9oMj5cbiAgICAgIDwvbGk+XG4gICAgey9lYWNofVxuICAgIDxsaSBjbGFzcz1cImZsZXggYXJvdW5kXCI+XG4gICAgICA8aDM+VG90YWw8L2gzPlxuICAgICAgPGIgY2xhc3M9XCJiaWdnZXJcIj4ke2Zvcm1hdE1vbmV5KGZpeGVkQ2FydC5yZWR1Y2UoKHN1bSwgeCkgPT4gc3VtICsgeC50b3RhbCwgMCkpfTwvYj5cbiAgICA8L2xpPlxuICA8L3VsPlxuICA8YXNpZGU+XG4gICAgPGgyIGNsYXNzPVwibm9zbCBiaWdnZXJcIj5DT05UQUNUIElORk8uPC9oMj5cbiAgICA8cCBjbGFzcz1cIm5vc2xcIj5QbGF0w61jYW5vcyBtw6FzIHNvYnJlIHRpLCBkZXNwdcOpcyBkZSByZWNpYmlyIHR1IHBlZGlkbyBub3MgY29tdW5pY2FyZW1vcyBjb250aWdvIHBhcmEgY29uZmlybWFyIHkgYWdlbmRhciBsYSBlbnRyZWdhL3BhZ28uPC9wPlxuICAgIDxmb3JtIG9uOnN1Ym1pdHxwcmV2ZW50RGVmYXVsdD17ZSA9PiBzZW5kKGUsIGZpeGVkQ2FydCl9IG1ldGhvZD1cInBvc3RcIiBhY3Rpb249XCJodHRwczovL2Zvcm1zcHJlZS5pby97Rk9STVNQUkVFX0FQSV9DT0RFfVwiPlxuICAgICAgPGxhYmVsIGNsYXNzPVwibm9zbFwiPlxuICAgICAgICA8c3Bhbj5UdSBub21icmU6PC9zcGFuPlxuICAgICAgICA8SW4gcmVxdWlyZWQgbmFtZT1cImZ1bGxuYW1lXCIgdHlwZT1cInRleHRcIiBtc2c9XCJQb3IgZmF2b3IgZXNjcmliZSB0dSBub21icmVcIiAvPlxuICAgICAgPC9sYWJlbD5cbiAgICAgIDxsYWJlbCBjbGFzcz1cIm5vc2xcIj5cbiAgICAgICAgPHNwYW4+Q29ycmVvIGVsZWN0csOzbmljbzo8L3NwYW4+XG4gICAgICAgIDxJbiByZXF1aXJlZCBuYW1lPVwiZW1haWxhZGRyXCIgdHlwZT1cImVtYWlsXCIgbXNnPVwiUG9yIGZhdm9yIGVzY3JpYmUgdHUgY29ycmVvXCIgLz5cbiAgICAgIDwvbGFiZWw+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJub3NsXCI+XG4gICAgICAgIDxzcGFuPk7Dum1lcm8gdGVsZWbDs25pY286PC9zcGFuPlxuICAgICAgICA8SW4gcmVxdWlyZWQgbmFtZT1cInBob25lbnVtXCIgdHlwZT1cInRleHRcIiBtc2c9XCJQb3IgZmF2b3IgZXNjcmliZSB0dSBuw7ptZXJvXCIgLz5cbiAgICAgIDwvbGFiZWw+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJub3NsXCI+XG4gICAgICAgIDxzcGFuPkRpcmVjY2nDs24gZGUgZW50cmVnYTo8L3NwYW4+XG4gICAgICAgIDxJbiByZXF1aXJlZCBuYW1lPVwiZnVsbGFkZHJcIiB0eXBlPVwidGV4dGFyZWFcIiByb3dzPVwiNlwiIG1zZz1cIlBvciBmYXZvciBlc2NyaWJlIHR1IGRpcmVjY2nDs25cIiAvPlxuICAgICAgPC9sYWJlbD5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJub3NsIHNvbGlkLXNoYWRvd1wiIHR5cGU9XCJzdWJtaXRcIiBkaXNhYmxlZD17ISRjYXJ0Lml0ZW1zLmxlbmd0aH0+UmVhbGl6YXIgcGVkaWRvPC9idXR0b24+XG4gICAgPC9mb3JtPlxuICA8L2FzaWRlPlxuPC9kaXY+XG4iLCJpbXBvcnQgQXBwIGZyb20gJy4vY29tcG9uZW50cy9BcHAuc3ZlbHRlJztcblxubmV3IEFwcCh7IC8vIGVzbGludC1kaXNhYmxlLWxpbmVcbiAgdGFyZ2V0OiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjYXBwJyksXG59KTtcbiJdLCJuYW1lcyI6WyJjb25zdCIsImxldCJdLCJtYXBwaW5ncyI6Ijs7Q0FBQSxTQUFTLElBQUks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QUUsRUFBRTtDQUNiLEVBQUUsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7Q0FDOUMsRUFBRSxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7Q0FDakMsRUFBRSxJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQzlCO0NBQ0EsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFO0NBQ2QsR0FBRyxLQUFLLEdBQUcsaUJBQWlCLENBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0NBQzdDLEdBQUcsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO0NBQ2IsR0FBRyxNQUFNLElBQUksT0FBTyxFQUFFO0NBQ3RCLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsU0FBUyxDQUFDLENBQUM7Q0FDL0IsR0FBRztBQUNIO0NBQ0EsRUFBRSxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFDN0M7Q0FDQSxFQUFFLElBQUksR0FBRyxJQUFJLFdBQVcsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQzFFLEVBQUU7QUFDRjtDQUNBLENBQUMsTUFBTSxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztDQUM3QixDQUFDLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7QUFDNUI7Q0FDQSxDQUFDLFNBQVMsTUFBTSxDQUFDLEtBQUssRUFBRTtDQUN4QixFQUFFLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0NBQzFCLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFB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