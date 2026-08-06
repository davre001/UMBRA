"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { useApp } from "@/providers/app-provider"

interface ShaderUniforms {
  [key: string]: THREE.IUniform
  resolution: { value: [number, number] }
  time: { value: number }
  xScale: { value: number }
  yScale: { value: number }
  distortion: { value: number }
  brightness: { value: number }
  targetBrightness: { value: number }
}

export function WebGLShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { isEntered } = useApp()
  const sceneRef = useRef<{
    scene: THREE.Scene | null
    camera: THREE.OrthographicCamera | null
    renderer: THREE.WebGLRenderer | null
    mesh: THREE.Mesh | null
    uniforms: ShaderUniforms | null
    animationId: number | null
  }>({
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    uniforms: null,
    animationId: null,
  })

  // Propagate isEntered changes into uniform value dynamically
  useEffect(() => {
    const { uniforms } = sceneRef.current
    if (uniforms && uniforms.targetBrightness) {
      uniforms.targetBrightness.value = isEntered ? 0.08 : 1.0
    }
  }, [isEntered])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const { current: refs } = sceneRef

    const vertexShader = `
      attribute vec3 position;
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float xScale;
      uniform float yScale;
      uniform float distortion;
      uniform float brightness;

      void main() {
        vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
        
        float d = length(p) * distortion;
        
        float rx = p.x * (1.0 + d);
        float gx = p.x;
        float bx = p.x * (1.0 - d);

        float wRed = 0.035 / abs(p.y + sin((rx + time) * xScale) * yScale);
        float wGreen = 0.035 / abs(p.y + sin((gx + time) * xScale) * yScale);
        float wBlue = 0.035 / abs(p.y + sin((bx + time) * xScale) * yScale);
        
        // White and Orange colors only
        vec3 colorOrange = vec3(1.0, 0.647, 0.0) * wGreen;
        vec3 colorWhite = vec3(1.0, 1.0, 1.0) * (wRed + wBlue) * 0.5;
        
        gl_FragColor = vec4((colorOrange + colorWhite) * brightness, 1.0);
      }
    `

    const initScene = () => {
      refs.scene = new THREE.Scene()
      refs.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      refs.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      refs.renderer.setClearColor(new THREE.Color(0x000000), 1)

      refs.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, -1)

      refs.uniforms = {
        resolution: { value: [window.innerWidth, window.innerHeight] },
        time: { value: 0.0 },
        xScale: { value: 2.0 },
        yScale: { value: 0.35 },
        distortion: { value: 0.06 },
        brightness: { value: isEntered ? 0.08 : 1.0 },
        targetBrightness: { value: isEntered ? 0.08 : 1.0 },
      }

      const position = [
        -1.0, -1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0, -1.0, 0.0,
        -1.0,  1.0, 0.0,
         1.0,  1.0, 0.0,
      ]

      const positions = new THREE.BufferAttribute(new Float32Array(position), 3)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", positions)

      const material = new THREE.RawShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: refs.uniforms,
        side: THREE.DoubleSide,
      })

      refs.mesh = new THREE.Mesh(geometry, material)
      refs.scene.add(refs.mesh)

      handleResize()
    }

    const animate = () => {
      if (refs.uniforms) {
        refs.uniforms.time.value += 0.015
        // Smoothly interpolate brightness towards target
        const diff = refs.uniforms.targetBrightness.value - refs.uniforms.brightness.value
        refs.uniforms.brightness.value += diff * 0.05
      }
      if (refs.renderer && refs.scene && refs.camera) {
        refs.renderer.render(refs.scene, refs.camera)
      }
      refs.animationId = requestAnimationFrame(animate)
    }

    const handleResize = () => {
      if (!refs.renderer || !refs.uniforms) return
      const width = window.innerWidth
      const height = window.innerHeight
      refs.renderer.setSize(width, height, false)
      refs.uniforms.resolution.value = [width, height]
    }

    initScene()
    animate()
    window.addEventListener("resize", handleResize)

    return () => {
      if (refs.animationId) cancelAnimationFrame(refs.animationId)
      window.removeEventListener("resize", handleResize)
      if (refs.mesh) {
        refs.scene?.remove(refs.mesh)
        refs.mesh.geometry.dispose()
        if (refs.mesh.material instanceof THREE.Material) {
          refs.mesh.material.dispose()
        }
      }
      refs.renderer?.dispose()
    }
  // isEntered is only read here for the *initial* brightness/targetBrightness
  // values at scene creation — the effect above keeps them in sync on every
  // later change without needing this one to re-run. Adding it here would
  // tear down and rebuild the whole WebGL scene/canvas on every toggle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full block z-0"
    />
  )
}
