import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';

interface ImageLightboxProps {
  imageUrl: string | null;
  imageAlt: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  imageUrl,
  imageAlt,
  isOpen,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Reset state when image changes
  useEffect(() => {
    if (imageUrl) {
      setIsLoading(true);
      setHasError(false);
      setScale(1);
      setRotation(0);
    }
  }, [imageUrl]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.5, 4));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.5, 0.5));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleReset = () => {
    setScale(1);
    setRotation(0);
  };

  if (!imageUrl) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-screen-lg w-[95vw] h-[95vh] max-h-[95vh] p-0 bg-black/95 border-white/10 flex flex-col items-center justify-center">
      <VisuallyHidden.Root>
      <DialogTitle>Görsel Görüntüleyici</DialogTitle>
      <DialogDescription>Büyütülmüş görsel önizlemesi</DialogDescription>
      </VisuallyHidden.Root>
      {/* Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={handleZoomIn}
            title="Yakınlaştır"
          >
            <ZoomIn size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={handleZoomOut}
            title="Uzaklaştır"
          >
            <ZoomOut size={18} />
          </Button>
          <span className="text-white/70 text-sm min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={handleRotate}
            title="Döndür"
          >
            <RotateCw size={18} />
          </Button>
          <div className="w-px h-6 bg-white/20 mx-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-white/70 hover:text-white hover:bg-white/10 text-xs"
            onClick={handleReset}
          >
            Sıfırla
          </Button>
        </div>

        {/* Close button */}
        <DialogClose asChild>
          <button
            className="absolute top-4 right-4 z-20 h-10 w-10 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all"
            title="Kapat"
          >
            <X size={20} />
          </button>
        </DialogClose>

        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
              <span className="text-white/60 text-sm">Yükleniyor...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3 text-white/60">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                <X size={32} />
              </div>
              <span className="text-sm">Görsel yüklenemedi</span>
            </div>
          </div>
        )}

        {/* Image */}
        <img
          src={imageUrl}
          alt={imageAlt || 'Büyütülmüş görsel'}
          className={cn(
            'max-w-full max-h-full object-contain transition-transform duration-200',
            isLoading && 'opacity-0'
          )}
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
          }}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />

        {/* Caption */}
        {imageAlt && !isLoading && !hasError && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-[80%] text-center">
            <span className="text-white/70 text-sm bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
              {imageAlt}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
