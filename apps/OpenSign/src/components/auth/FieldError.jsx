function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} aria-live="polite" className="text-xs text-red-500 mt-1">
      {message}
    </p>
  );
}

export default FieldError;
