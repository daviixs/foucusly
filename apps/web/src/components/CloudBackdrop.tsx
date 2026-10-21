import { useEffect, useState } from "react";
import lightCloud from "../assets/Cloud.png";

type Point = { x: number; y: number };
type Viewport = { width: number; height: number };

function CloudLayer({
  depth,
  factor,
  viewport,
  pointer,
}: {
  depth: "front" | "mid" | "back";
  factor: number;
  viewport: Viewport;
  pointer: Point;
}) {
  const [loaded, setLoaded] = useState(false);
  const x = (viewport.width / 2 - pointer.x) * factor;
  const y = (viewport.height / 2 - pointer.y) * factor;

  return (
    <div className={`craft-cloud-layer craft-cloud-layer--${depth}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <img
        className={`craft-cloud craft-cloud--${depth}${loaded ? " is-loaded" : ""}`}
        src={lightCloud}
        alt=""
        width="100%"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export default function CloudBackdrop() {
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });
  const [viewport, setViewport] = useState<Viewport>({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const movePointer = (event: MouseEvent) => setPointer({ x: event.clientX, y: event.clientY });
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });

    window.addEventListener("mousemove", movePointer, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    return () => {
      window.removeEventListener("mousemove", movePointer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="craft-cloud-backdrop" aria-hidden="true">
      <CloudLayer depth="front" factor={0.01} viewport={viewport} pointer={pointer} />
      <CloudLayer depth="mid" factor={0.006} viewport={viewport} pointer={pointer} />
      <CloudLayer depth="back" factor={0.003} viewport={viewport} pointer={pointer} />
    </div>
  );
}
