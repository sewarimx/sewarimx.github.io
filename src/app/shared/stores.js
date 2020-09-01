import { writable } from 'svelte/store';

export const session = writable({
  loggedIn: false,
});

export default {
  session,
};
