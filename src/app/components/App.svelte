<script>
  import { cart } from '../shared/stores';
  import Num from './Number.svelte';
  import In from './Input.svelte';

  const products = window.products$ || [];

  let done = false;

  function close() {
    done = false;
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
        qty: x.count,
        name: x.name,
        total: x.total,
      })),
    };

    $cart.items = [];
    done = true;
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
    const target = $cart.items.find(x => x.key === item.key);

    target.count = parseFloat((e.detail || e.target).value);
    $cart.status = 'updated';
    sync();
  }

  function rm(item) {
    if (!confirm('¿Estás seguro?')) return;
    $cart.items = $cart.items.filter(x => x.key !== item.key);
    $cart.status = 'removed';
    sync();
  }

  $: fixedCart = $cart.items.map(x => ({
    ...x,
    ...products[x.key],
    total: products[x.key].price * x.count,
  }));
</script>

{#if done}
  <div class="fixed overlay">
    <div class="nosl">
      <h2 class="biggest">MUCHAS GRACIAS</h2>
      <p>Tu pedido ha sido recibido, nos comunicaremos contigo a la brevedad.</p>
      <button class="solid-shadow" on:click={close}>CERRAR</button>
    </div>
  </div>
{/if}

<h1 class="nosl biggest">SHOPPING LIST</h1>
<div class="md-flex">
  <ul class="reset">
    {#each fixedCart as item (item.key)}
      <li class="flex">
        <div class="overlay">
          <Num value={item.count} on:change={e => set(e, item)} />
          <button class="nosl solid-shadow" on:click={() => rm(item)}>Eliminar</button>
        </div>
        <figure>
          <img class="nosl" alt={item.name} src={item.image}/>
          <figcaption class="flex">
            <h2 class="f-100">{item.name}</h2>
            <b class="bigger">${item.price * item.count}</b>
          </figcaption>
        </figure>
      </li>
    {:else}
      <li class="wip nosl">
        <h2>No items in your basket...</h2>
      </li>
    {/each}
    <li class="flex">
      <h3>Total</h3>
      <b class="bigger">${fixedCart.reduce((sum, x) => sum + x.total, 0)}</b>
    </li>
  </ul>
  <aside>
    <h2 class="nosl bigger">CONTACT INFO.</h2>
    <p class="nosl">Platícanos más sobre ti, después de recibir tu pedido nos comunicaremos contigo para confirmar y agendar la entrega/pago.</p>
    <form on:submit|preventDefault={e => send(e, fixedCart)} method="post" action="https://formspree.io/xdowrvjr">
      <label class="nosl">
        <span>Tu nombre:</span>
        <In required name="fullname" type="text" msg="Por favor escribe tu nombre" />
      </label>
      <label class="nosl">
        <span>Correo electrónico:</span>
        <In required name="emailaddr" type="email" msg="Por favor escribe tu correo" />
      </label>
      <label class="nosl">
        <span>Número telefónico:</span>
        <In required name="phonenum" type="text" msg="Por favor escribe tu número" />
      </label>
      <label class="nosl">
        <span>Dirección de entrega:</span>
        <In required name="fulladdr" type="textarea" rows="6" msg="Por favor escribe tu dirección" />
      </label>
      <button class="nosl solid-shadow" type="submit" disabled={!$cart.items.length}>Realizar pedido</button>
    </form>
  </aside>
</div>
