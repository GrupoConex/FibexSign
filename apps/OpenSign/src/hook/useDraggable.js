import { useState, useRef, useCallback } from "react";

/**
 * Hook para hacer cualquier barra o componente arrastrable por la pantalla.
 * Al recargar o reiniciar la página vuelve automáticamente a su posición de origen {x: 0, y: 0}.
 */
export function useDraggable({ initialPosition = { x: 0, y: 0 } } = {}) {
  const [position, setPosition] = useState(initialPosition);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const elementStartRef = useRef({ x: 0, y: 0 });

  const resetPosition = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      // Ignorar clics en botones, inputs o enlaces para no interferir con su acción
      if (e.target.closest("button, input, select, textarea, a, .no-drag")) {
        return;
      }
      // Solo botón izquierdo del mouse
      if (e.button !== 0) return;

      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      elementStartRef.current = { ...position };

      const handleMouseMove = (moveEvent) => {
        if (!isDraggingRef.current) return;
        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;
        setPosition({
          x: elementStartRef.current.x + dx,
          y: elementStartRef.current.y + dy
        });
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [position]
  );

  const handleTouchStart = useCallback(
    (e) => {
      if (e.target.closest("button, input, select, textarea, a, .no-drag")) {
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      isDraggingRef.current = true;
      dragStartRef.current = { x: touch.clientX, y: touch.clientY };
      elementStartRef.current = { ...position };

      const handleTouchMove = (moveEvent) => {
        if (!isDraggingRef.current) return;
        const currentTouch = moveEvent.touches[0];
        if (!currentTouch) return;
        const dx = currentTouch.clientX - dragStartRef.current.x;
        const dy = currentTouch.clientY - dragStartRef.current.y;
        setPosition({
          x: elementStartRef.current.x + dx,
          y: elementStartRef.current.y + dy
        });
      };

      const handleTouchEnd = () => {
        isDraggingRef.current = false;
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
      };

      window.addEventListener("touchmove", handleTouchMove, { passive: true });
      window.addEventListener("touchend", handleTouchEnd);
    },
    [position]
  );

  return {
    position,
    setPosition,
    resetPosition,
    dragProps: {
      onMouseDown: handleMouseDown,
      onTouchStart: handleTouchStart,
      style: {
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: "grab",
        userSelect: "none"
      }
    }
  };
}

export default useDraggable;
