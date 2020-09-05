import { writable } from 'svelte/store';

export const cart = writable({
  items: [],
  status: 'idle',
});

let skip;

cart.subscribe(data => {
  if (!skip && data.status !== 'idle') {
    window.localStorage.cart$ = JSON.stringify(data);
  }
});

if (window.localStorage.cart$) {
  skip = true;
  cart.update(() => ({
    ...JSON.parse(window.localStorage.cart$),
    status: 'loaded',
  }));
  skip = false;
}

export default {
  cart,
};
