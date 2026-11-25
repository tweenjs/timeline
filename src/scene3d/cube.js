import * as THREE from 'three'

export function cubeScene(canvas) {
	// A three.js layer is a function. It gets the layer's canvas, builds a scene
	// with three.js, and returns what draws one frame of it.
	const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)

	const cube = new THREE.Mesh(
		new THREE.BoxGeometry(1.4, 1.4, 1.4),
		new THREE.MeshStandardMaterial({color: '#4dabf7', roughness: 0.35, metalness: 0.1}),
	)
	const sun = new THREE.DirectionalLight('#ffffff', 2.5)
	sun.position.set(2, 3, 4)
	scene.add(cube, sun, new THREE.AmbientLight('#ffffff', 0.6))

	let size = ''
	return {
		// `frame` is the playhead (`time` of `duration`, in milliseconds) and the
		// layer as the timeline has it at that moment: `rotation`, `scale`,
		// `width`, `height`. Draw from those alone, so that scrubbing works.
		draw(frame) {
			if (size !== frame.width + 'x' + frame.height) {
				size = frame.width + 'x' + frame.height
				renderer.setPixelRatio(window.devicePixelRatio)
				renderer.setSize(frame.width, frame.height, false)
				camera.aspect = frame.width / frame.height
				camera.updateProjectionMatrix()
			}
			// Keyframes on the layer's rotation turn the cube, and on its scale bring it closer.
			cube.rotation.y = (frame.rotation * Math.PI) / 180
			cube.rotation.x = (frame.time / frame.duration) * Math.PI * 2
			camera.position.z = 4 / Math.max(0.1, frame.scale)
			renderer.render(scene, camera)
		},
		dispose() {
			cube.geometry.dispose()
			cube.material.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
		},
	}
}
