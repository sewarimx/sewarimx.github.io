<script>
  import { cart } from '../shared/stores';

  let ref;
  let count;
  let interval;

  window.cartSync = data => cart.set(data);

  function add(e) {
    if (e.target.tagName === 'BUTTON' && e.target.dataset.buy) {
      const currentItem = $cart.items.find(x => x.name === e.target.dataset.buy);

      if (currentItem) {
        currentItem.count += 1;
      } else {
        $cart.items.push({
          image: 'images/coldbrew_three_bottles.jpg',
          name: e.target.dataset.buy,
          price: 1.99,
          count: 1,
        });
      }

      $cart.status = 'added';
    }
  }

  $: count = $cart.items.reduce((count, item) => count + item.count, 0);
  $: if ($cart.status !== 'idle') {
    clearTimeout(interval);
    interval = setTimeout(() => {
      $cart.status = 'idle';
    }, 3000);
  }
</script>

<style>
  .notify {
    color: #95721C;
    padding: 15px;
    background-color: #FFEA9F;
    position: fixed;
    top: 120px;
    right: -100%;
    transition: all .3s;
  }
  .removed,
  .updated,
  .added {
    right: 0;
  }
</style>

<svelte:window on:click={add} />

<span bind:this={ref} class="notify {$cart.status}">An item was {$cart.status}</span>
<span class="counter">{count || '-'}</span>
