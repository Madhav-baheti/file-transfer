import { useEffect, useState, type ReactNode } from 'react';

interface BlobDownloadLinkProps {
  blob: Blob;
  filename: string;
  className?: string;
  children: ReactNode;
}

export function BlobDownloadLink({
  blob,
  filename,
  className,
  children,
}: BlobDownloadLinkProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  if (!objectUrl) {
    return null;
  }

  return (
    <a href={objectUrl} download={filename} className={className}>
      {children}
    </a>
  );
}
