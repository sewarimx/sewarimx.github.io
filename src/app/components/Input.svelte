<script>
  export let type = 'text';
  export let msg = 'Por favor completa éste campo';

  let savedData = {};

  if (window.localStorage.input$) {
    savedData = JSON.parse(window.localStorage.input$);
  }

  function check(e) {
    e.target.setCustomValidity('');

    if (!e.target.validity.valid) {
      e.target.setCustomValidity(msg);
    }
  }

  function reset(e) {
    e.target.setCustomValidity('');
  }

  function update(e) {
    savedData[$$props.name] = e.target.value;
    window.localStorage.input$ = JSON.stringify(savedData);
  }

  $: fixedProps = { ...$$props, value: $$props.value || savedData[$$props.name] || '', msg: undefined, type: undefined };
</script>

{#if type === 'textarea'}
  <textarea on:invalid={check} on:input={reset} on:blur={update} {...fixedProps} />
{:else}
  <input on:invalid={check} on:input={reset} on:blur={update} {...fixedProps} {type} />
{/if}
