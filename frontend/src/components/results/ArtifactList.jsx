import { api } from '../../api/client';

export default function ArtifactList({ artifacts }) {
  if (!artifacts?.length) return null;
  return (
    <>
      <h3>Artifacts</h3>
      <div className="artifacts">
        {artifacts.map((a) => (
          <button key={a.fileId} type="button" className="btn btn-ghost" onClick={() => api.download(a.downloadUrl, a.name)}>
            ⬇ {a.name}
          </button>
        ))}
      </div>
    </>
  );
}
