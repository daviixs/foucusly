import { useEffect, useState } from "react";
import lightCloud from "../assets/Cloud.png";
import darkCloud from "../assets/CloudDark.png";

type Point = { x: number; y: number };
type Viewport = { width: number; height: number };

function CloudLayer({
  src,
  depth,
  factor,
  viewport,
  pointer,
}: {
  src: string;
  depth: "front" | "mid" | "back" | "dark-back";
  factor: number;
  viewport: Viewport;
  pointer: Point;
}) {
  const [loaded, setLoaded] = useState(false);
  const x = (viewport.width / 2 - pointer.x) * factor;
  const y = (viewport.height / 2 - pointer.y) * factor;

  return (
    <div
      className={`craft-cloud-layer craft-cloud-layer--${depth}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <img
        className={`craft-cloud craft-cloud--${depth}${loaded ? " is-loaded" : ""}`}
        src={src}
        alt=""
        width="100%"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export default function CloudBackdrop({ dark = false }: { dark?: boolean }) {
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
    <div className={`craft-cloud-backdrop${dark ? " is-dark" : ""}`} aria-hidden="true">
      {!dark && <CloudLayer key="light-front" src={lightCloud} depth="front" factor={0.01} viewport={viewport} pointer={pointer} />}
      <CloudLayer key={dark ? "dark-mid" : "light-mid"} src={dark ? darkCloud : lightCloud} depth="mid" factor={0.006} viewport={viewport} pointer={pointer} />
      {dark ? (
        <CloudLayer key="dark-back" src={darkCloud} depth="dark-back" factor={0.003} viewport={viewport} pointer={pointer} />
      ) : (
        <CloudLayer key="light-back" src={lightCloud} depth="back" factor={0.003} viewport={viewport} pointer={pointer} />
      )}
    </div>
  );
}
