# Old boilerplate for web-pages!

![12in](https://github.com/tacoss/plate/raw/master/src/resources/images/12inches_small.png)

> Pure hits &amp; good music for your ears.
>
> [![Remix on Glitch](https://cdn.glitch.com/2703baf2-b643-4da7-ab91-7ee2a2d00b5b%2Fremix-button.svg)](https://glitch.com/edit/#!/remix/dubplate)

- **ESLint** &mdash; to check your code
- **Bublé** &mdash; to transpile your ES6
- **Rollup.js** &mdash; to bundle everything
- **Live Reload** &mdash; to quick reload on dev!
- **LESS** & **Pug** for other assets &mdash; y'know ;-)

Also, it enables advanced images-to-sprite output through [talavera](https://github.com/pateketrueke/talavera).

## Installation

```bash
$ npx haki tacoss/plate website
```

Once done just move inside with `cd website` and continue reading.

> Are you coming from glitch.com? Try editing the files inside the `src` directory on the left and see what happens!

## How it works?

It includes a fancy `Makefile` for quick usage:

- `make dev` to start the development server, it'll wait for you!
- `make dist` to build the final assets for production
- `make clean` to remove all generated files

Type `make` without arguments to display usage info.

> Read the [tarima docs](https://github.com/tacoss/tarima#tarima) to know more about the tooling used.

Deployment is designed to go through GitHub pages ([preview](https://tacoss.github.io/plate/)), so `make deploy` would do all the required job...

- If you got `fatal: invalid reference: gh-pages` try to create that branch first with `git branch gh-pages`.
- If yoo got `fatal: 'build' already exists` type `make clean dist` before deploying.

Files found at `./build` are ready to be served.

## Why not something else?

I tried (several times) to setup all goods from this repository: deps, pages, assets, etc. with Webpack, Rollup.js or even Parcel without any success yet.

So, that's why I created this starter.

Enjoy!
