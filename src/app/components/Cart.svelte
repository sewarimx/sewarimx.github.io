<script>
  import { cart } from '../shared/stores';

  let ref;
  let count;
  let interval;

  window.cartSync = data => cart.set(data);

  $: count = $cart.items.reduce((count, item) => count + item.qty, 0);
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

<span bind:this={ref} class="notify {$cart.status}">An item was {$cart.status}</span>
<span class="counter">{count || '-'}</span>
