import React, { useEffect, useRef, useState } from "react";

// AirDraw: desenhe no ar com sua mão (pinça polegar + indicador para desenhar)
// Tecnologias tradicionais e consolidadas: getUserMedia + MediaPipe Tasks Vision (Hand Landmarker)
// Compatível com Chrome/Edge/Opera (desktop). Permita acesso à câmera.

export default function AirDraw() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null); // canvas de desenho
  const landmarksRef = useRef(null); // canvas de overlay p/ depuração (opcional)
  const handLandmarkerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [mirror, setMirror] = useState(true);
  const [brushSize, setBrushSize] = useState(6);
  const [brushColor, setBrushColor] = useState("#111827");
  const [eraser, setEraser] = useState(false);
  const [fps, setFps] = useState(0);

  // util: distância euclidiana entre dois pontos normalizados [0..1]
  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  // Inicializa câmera
  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        console.error("Erro ao acessar câmera", e);
      }
    })();
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Carrega modelo MediaPipe Hand Landmarker
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await window.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const handLandmarker = await window.HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minTrackingConfidence: 0.5,
          minDetectionConfidence: 0.6,
        });
        if (!cancelled) {
          handLandmarkerRef.current = handLandmarker;
          setReady(true);
        }
      } catch (e) {
        console.error("Falha ao carregar modelo de mãos", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Loop principal: detectar mão e desenhar
  useEffect(() => {
    if (!ready) return;
    let raf;
    let last = performance.now();

    const loop = () => {
      const now = performance.now();
      const dt = now - last;
      if (dt > 0) setFps(Math.round(1000 / dt));
      last = now;

      const video = videoRef.current;
      const canvas = overlayRef.current;
      const debug = landmarksRef.current;
      if (!video || !canvas) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const W = video.videoWidth || 1280;
      const H = video.videoHeight || 720;

      // Ajusta canvas ao tamanho do vídeo
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      if (debug) {
        if (debug.width !== W) debug.width = W;
        if (debug.height !== H) debug.height = H;
      }

      const hl = handLandmarkerRef.current;
      if (hl) {
        const results = hl.detectForVideo(video, now);
        if (results?.landmarks?.length) {
          const lm = results.landmarks[0]; // mão principal
          const idxTip = lm[8]; // indicador ponta
          const thumbTip = lm[4]; // polegar ponta

          // Pinça = desenhar
          const pinch = dist(idxTip, thumbTip) < 0.045; // limiar empírico em coords normalizadas

          const x = (mirror ? 1 - idxTip.x : idxTip.x) * W;
          const y = idxTip.y * H;

          const ctx = canvas.getContext("2d");
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          if (pinch) {
            if (!drawing) setDrawing(true);
            ctx.strokeStyle = eraser ? "#ffffff" : brushColor; // apaga com "branco" sobre fundo padrão
            ctx.lineWidth = brushSize;
            // desenha ponto/segmento contínuo usando property lastPos no canvas
            const lp = canvas._lastPos || { x, y };
            ctx.beginPath();
            ctx.moveTo(lp.x, lp.y);
            ctx.lineTo(x, y);
            ctx.stroke();
            canvas._lastPos = { x, y };
          } else {
            setDrawing(false);
            canvas._lastPos = null;
          }

          // Debug de landmarks (opcional)
          if (debug) {
            const dctx = debug.getContext("2d");
            dctx.clearRect(0, 0, W, H);
            dctx.save();
            if (mirror) {
              dctx.translate(W, 0);
              dctx.scale(-1, 1);
            }
            dctx.fillStyle = "rgba(0,0,0,0.2)";
            for (const p of lm) {
              dctx.beginPath();
              dctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
              dctx.fill();
            }
            dctx.restore();
          }
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, brushSize, brushColor, eraser, mirror, drawing]);

  // Limpar e salvar
  const clearCanvas = () => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const savePNG = () => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `airdraw-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  // Carregar scripts do MediaPipe Tasks via tags <script> tradicionais (robusto e previsível)
  useEffect(() => {
    const have = !!window.HandLandmarker;
    if (have) return; // já carregado
    const s1 = document.createElement("script");
    s1.src = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/vision_bundle.mjs";
    s1.type = "module";

    const s2 = document.createElement("script");
    s2.src = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/fileset.js";
    s2.type = "module";

    document.body.appendChild(s1);
    document.body.appendChild(s2);

    return () => {
      document.body.removeChild(s1);
      document.body.removeChild(s2);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-100 text-gray-900">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">AirDraw – Desenho no Ar (Mão)</h1>
          <div className="text-sm opacity-70">{ready ? `FPS ~ ${fps}` : "Carregando modelo..."}</div>
        </header>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 relative rounded-2xl overflow-hidden shadow bg-white">
            <div className="relative">
              <video
                ref={videoRef}
                className={`w-full h-auto ${mirror ? "scale-x-[-1]" : ""}`}
                playsInline
                muted
              />
              {/* Canvas de desenho sobreposto */}
              <canvas
                ref={overlayRef}
                className="absolute inset-0 pointer-events-none"
              />
              {/* Canvas de landmarks para depuração (pode ocultar) */}
              <canvas
                ref={landmarksRef}
                className="absolute inset-0 pointer-events-none"
                style={{ display: "none" }}
              />
            </div>
          </div>

          <aside className="space-y-3 p-3 bg-white rounded-2xl shadow">
            <div className="text-sm">Use o gesto de pinça (polegar + indicador) para desenhar. Solte para parar.</div>
            <div className="flex items-center gap-2">
              <label className="text-sm">Espessura</label>
              <input
                type="range"
                min={1}
                max={30}
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="w-10 text-center text-sm">{brushSize}px</div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm">Cor</label>
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                className="h-8 w-10"
                disabled={eraser}
              />
              <button
                onClick={() => setEraser((v) => !v)}
                className={`px-3 py-2 rounded-xl border text-sm ${eraser ? "bg-gray-900 text-white" : "bg-gray-50"}`}
                title="Alternar borracha"
              >
                {eraser ? "Borracha ON" : "Borracha OFF"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={clearCanvas} className="px-3 py-2 rounded-xl border text-sm bg-gray-50">Limpar</button>
              <button onClick={savePNG} className="px-3 py-2 rounded-xl border text-sm bg-gray-50">Salvar PNG</button>
              <button onClick={() => setMirror((v) => !v)} className="px-3 py-2 rounded-xl border text-sm bg-gray-50">
                {mirror ? "Desespelhar" : "Espelhar"}
              </button>
            </div>

            <details className="text-sm opacity-80">
              <summary className="cursor-pointer">Notas técnicas</summary>
              <ul className="list-disc ml-4 mt-2 space-y-1">
                <li>Requer câmera. Dê permissão ao navegador.</li>
                <li>Pinça detectada pela distância entre as landmarks 4 (polegar) e 8 (indicador).</li>
                <li>Se o desempenho cair, reduza a resolução da câmera nas permissões do navegador.</li>
              </ul>
            </details>
          </aside>
        </div>
      </div>
    </div>
  );
}
