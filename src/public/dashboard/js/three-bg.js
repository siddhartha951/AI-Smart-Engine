import * as THREE from 'three';

let scene, camera, renderer, particles;

function init() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas) return;

  // Scene setup
  scene = new THREE.Scene();
  // Slightly tinted fog to blend with the dark background
  scene.fog = new THREE.FogExp2(0x0f172a, 0.001);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 300;

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Particles
  const geometry = new THREE.BufferGeometry();
  const particlesCount = 1500;
  const posArray = new Float32Array(particlesCount * 3);
  const colorArray = new Float32Array(particlesCount * 3);

  const color1 = new THREE.Color(0x3b82f6); // primary blue
  const color2 = new THREE.Color(0xa855f7); // purple

  for (let i = 0; i < particlesCount * 3; i++) {
    // Spread particles across a wide area
    posArray[i] = (Math.random() - 0.5) * 800;
  }

  for (let i = 0; i < particlesCount; i++) {
    const mixedColor = color1.clone().lerp(color2, Math.random());
    colorArray[i * 3] = mixedColor.r;
    colorArray[i * 3 + 1] = mixedColor.g;
    colorArray[i * 3 + 2] = mixedColor.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

  // Material with additive blending for glow
  const material = new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.8
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Mouse interaction
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onWindowResize);

  animate();
}

let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;
const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

function onMouseMove(event) {
  mouseX = (event.clientX - windowHalfX) * 0.1;
  mouseY = (event.clientY - windowHalfY) * 0.1;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  targetX = mouseX * 0.5;
  targetY = mouseY * 0.5;

  particles.rotation.y += 0.001;
  particles.rotation.x += 0.0005;

  // Gentle parallax based on mouse
  camera.position.x += (targetX - camera.position.x) * 0.02;
  camera.position.y += (-targetY - camera.position.y) * 0.02;
  camera.lookAt(scene.position);

  renderer.render(scene, camera);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
