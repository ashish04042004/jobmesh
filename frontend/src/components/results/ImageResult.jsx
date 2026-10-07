import { useAuthedObjectUrl } from '../../hooks/useAuthedObjectUrl';
import { formatBytes } from '../../utils/format';
import { Kpi } from './CsvResult';
import ArtifactList from './ArtifactList';

export default function ImageResult({ result }) {
  const { original, outputs } = result;
  const thumbnailUrl = useAuthedObjectUrl(outputs.thumbnail.downloadUrl);
  const resizedUrl = useAuthedObjectUrl(outputs.resized.downloadUrl);

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Original" value={`${original.width}×${original.height} ${original.format}`} />
        <Kpi label="Original size" value={formatBytes(original.bytes)} />
        <Kpi label="Resized" value={`${outputs.resized.width}×${outputs.resized.height}`} />
        <Kpi label="Compression" value={`${result.compressionRatio}×`} />
      </div>

      <div className="image-previews">
        {resizedUrl && (
          <figure>
            <img src={resizedUrl} alt="Resized output" className="preview-large" />
            <figcaption className="muted">
              Resized · {formatBytes(outputs.resized.bytes)}
            </figcaption>
          </figure>
        )}
        {thumbnailUrl && (
          <figure>
            <img src={thumbnailUrl} alt="Thumbnail output" />
            <figcaption className="muted">
              Thumbnail · {outputs.thumbnail.width}×{outputs.thumbnail.height} · {formatBytes(outputs.thumbnail.bytes)}
            </figcaption>
          </figure>
        )}
      </div>

      <ArtifactList artifacts={[outputs.resized, outputs.thumbnail]} />
    </>
  );
}
