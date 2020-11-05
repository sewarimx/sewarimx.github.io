<script>
  import { createEventDispatcher } from 'svelte';

  export let minimum = 1;
  export let value = 0;

  const dispatch = createEventDispatcher();

  let disabled = false;
  let ref;

  function sync() {
    dispatch('change', ref);
  }

  function inc() {
    ref.value = parseFloat(ref.value) + 1;
    sync();
  }

  function dec() {
    ref.value = parseFloat(ref.value) - 1;
    sync();
  }

  $: if (value !== minimum) {
    value = Math.max(parseFloat(ref.value), minimum);
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
  <button disabled={disabled || value === minimum} class="nosl" on:click={dec}>-</button>
  <input type="number" min={minimum} bind:this={ref} bind:value on:change={sync} />
  <button class="nosl" on:click={inc}>+</button>
</span>
