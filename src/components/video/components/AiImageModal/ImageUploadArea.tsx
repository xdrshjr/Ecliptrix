'use client';

import React, { useCallback, useRef, useState } from 'react';

interface ImageUploadAreaProps {
  value: string | null;
  onChange: (base64: string | null) => void;
}

const readAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const ImageUploadArea: React.FC<ImageUploadAreaProps> = ({ value, onChange }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readAsDataURL(file);
      onChange(dataUrl);
    } catch {
      onChange(null);
    }
  }, [onChange]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  if (value) {
    return (
      <div className="relative group rounded border border-border bg-muted/40 overflow-hidden">
        <img src={value} alt="reference" className="w-full h-40 object-contain" />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-1 right-1 px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center h-40 rounded border-2 border-dashed cursor-pointer transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 bg-muted/20'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="text-xs text-muted-foreground">
        Click or drop image here
      </div>
    </div>
  );
};

export default ImageUploadArea;
