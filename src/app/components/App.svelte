<script>
  import { cart } from '../shared/stores';

  const products = window.products$ || [];

  function sync() {
    if (window.cartSync) {
      window.cartSync($cart);
    }
  }

  function set(e, item) {
    item.count = parseFloat(e.target.value);
    $cart.status = 'updated';
    sync();
  }

  function rm(item) {
    if (!confirm('Are you sure?')) return;
    $cart.items = $cart.items.filter(x => x.key !== item.key);
    $cart.status = 'removed';
    sync();
  }
</script>

<h1 class="nosl">SHOPPING LIST</h1>
<div class="md-flex">
  <ul class="reset">
    {#each $cart.items as item (item.key)}
      <li class="flex">
        <div class="overlay">
          <input type="number" min="1" value={item.count} on:change={e => set(e, item)} />
          <button class="nosl solid-shadow" on:click={() => rm(item)}>Remove</button>
        </div>
        <figure>
          <img class="nosl" alt={products[item.key].name} src={products[item.key].image}/>
          <figcaption class="flex">
            <h2 class="f-100">{products[item.key].name}</h2>
            <b class="bigger">${products[item.key].price * item.count}</b>
          </figcaption>
        </figure>
      </li>
    {:else}
      <div class="wip nosl">
        <h2>No items in your basket...</h2>
      </div>
    {/each}
  </ul>
  <aside>
    <h2 class="nosl biggest">How to pay?</h2>
    <p class="nosl">How to...</p>
    <form on:submit|preventDefault method="post" action="https://formspree.io/xdowrvjr">
      <label class="nosl">
        <span>Field</span>
        <input required type="text" />
      </label>
      <label class="nosl">
        <span>Field</span>
        <input required type="email" />
      </label>
      <label class="nosl">
        <span>Field</span>
        <textarea required rows="6"></textarea>
      </label>
      <button class="nosl solid-shadow" type="submit" disabled={!$cart.items.length}>Send request</button>
    </form>
  </aside>
</div>
