export default function ErrorMessage({ error }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error.message}
      {error.details?.length > 0 && (
        <ul>
          {error.details.map((d) => (
            <li key={`${d.path}:${d.message}`}>
              <code>{d.path}</code>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
