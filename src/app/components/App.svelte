<script>
  import { Router, Route, Link } from 'yrv';

  import NotFound from './pages/NotFound.svelte';
  import Home from './pages/Home.svelte';
</script>

<Router path="/admin">
  <nav>
    <nav>
      <Link exact href="/admin/">Dashboard</Link>
      | <Link exact href="/admin/not-found">Page not found</Link>
    </nav>
  </nav>
  <main>
    <Route exact path="/" component={Home} />
    <Route fallback component={NotFound} />
  </main>
</Router>
