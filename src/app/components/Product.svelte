<script>
  import { formatMoney } from '../shared/helpers';
  import { cart } from '../shared/stores';
  import Num from './Number.svelte';

  export let count = 1;
  export let selected = null;

  const product = window.product$ || {};

  let isValid = true;
  let active = [];

  function sync() {
    if (window.cartSync) {
      window.cartSync($cart);
    }
  }

  function set(e) {
    selected = product.prices.find(x => x.label === e.target.value);
  }

  function add() {
    $cart.items.push({
      id: Math.random().toString(36).substr(2, 7),
      key: product.key,
      qty: count,
      ...selected,
    });
    $cart.status = 'added';
    selected = null;
    active = [];
    count = 1;
    sync();
  }

  $: if (selected) {
    isValid = !selected.required || count >= selected.required;
  }
</script>

<h3>Presentación</h3>
<ul class="reset">
  {#each product.prices as price}
    <li>
      <label>
        <input type="radio" name="price" on:change={set} bind:group={active} value={price.label} />
        {price.label}{price.required ? `* ${price.required}pz` : ''} &mdash; ${formatMoney(price.value)} MXN {price.required ? '/cu' : ''}
        {#if count > 1}
          <small>&times;{count} &rarr; ${formatMoney(price.value * count)} MXN</small>
        {/if}
      </label>
    </li>
  {/each}
</ul>

<div class="flex space">
  <Num bind:value={count} minimum={(selected && selected.required) || 1} on:change={e => { count = parseFloat(e.detail.value) }} />
  <button disabled={!selected || !isValid} on:click={add} class="nosl solid-shadow">COMPRAR</button>
</div>
