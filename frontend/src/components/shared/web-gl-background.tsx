"use client"

import dynamic from "next/dynamic"

const WebGLShader = dynamic(
  () => import("@/components/ui/web-gl-shader").then((mod) => mod.WebGLShader),
  { ssr: false }
)

export function WebGLBackground() {
  return <WebGLShader />
}
