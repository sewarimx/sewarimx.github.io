<script>
  import { createEventDispatcher } from 'svelte';

  export let value = 0;

  const dispatch = createEventDispatcher();

  let ref;

  function inc() {
    ref.value = parseFloat(ref.value) + 1;
    dispatch('change', ref);
  }

  function dec() {
    if (ref.value <= ref.getAttribute('min')) return;
    ref.value = parseFloat(ref.value) - 1;
    dispatch('change', ref);
  }
</script>

<style>
  span {
    display: flex;
  }

  input {
    width: 60px !important;
    text-align: center;
    position: relative;
    z-index: 2;
  }

  button {
    position: relative;
    z-index: 1;
  }
</style>

<span>
  <button class="nosl" on:click={dec}>-</button>
  <input type="number" min="1" bind:this={ref} bind:value on:change />
  <button class="nosl" on:click={inc}>+</button>
</span>
