/*
  HERO 3D BACKGROUND
  ------------------
  A slow-rotating wireframe icosahedron, rendered in the site's amber accent color.
  Purely decorative (aria-hidden, no pointer events). Skips animation entirely if
  the visitor has "reduce motion" turned on, or if the canvas isn't visible
  (e.g. hidden by CSS on narrower screens).
*/

(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  // Respect the visitor's reduced-motion preference: render one static frame, no loop.
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Skip entirely on screens where the CSS hides the canvas anyway (no point paying the cost).
  if (getComputedStyle(canvas).display === 'none') return;

  const width = canvas.clientWidth || 340;
  const height = canvas.clientHeight || 420;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  // Amber accent color, matching --amber in styles.css.
  const amber = 0xA9752F;

  const geometry = new THREE.IcosahedronGeometry(1.6, 0);
  const wireframe = new THREE.WireframeGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: amber, transparent: true, opacity: 0.8 });
  const shape = new THREE.LineSegments(wireframe, material);
  scene.add(shape);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);

  if (prefersReducedMotion) {
    // Render a single static frame at a pleasant angle, then stop.
    shape.rotation.x = 0.4;
    shape.rotation.y = 0.6;
    renderer.render(scene, camera);
    return;
  }

  function animate() {
    requestAnimationFrame(animate);
    shape.rotation.x += 0.0015;
    shape.rotation.y += 0.0022;
    renderer.render(scene, camera);
  }
  animate();
})();
