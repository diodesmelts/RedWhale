import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X } from "lucide-react";
import { useDebugOverlay } from "./debug-overlay";
import { apiRequest } from "@/lib/queryClient";
import { getImageUrl } from "@/lib/utils";

interface ImageUploadProps {
  onImageUploaded: (imageUrl: string) => void;
  currentImageUrl?: string;
  existingImageUrl?: string | null;
  className?: string;
}

export function ImageUpload({
  onImageUploaded,
  currentImageUrl = "",
  existingImageUrl = null,
  className = "",
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  // Use our utility function to ensure the initial preview URL is properly formatted
  // Prioritize existingImageUrl over currentImageUrl for backward compatibility
  const initialImageUrl = existingImageUrl || currentImageUrl || "";
  const [preview, setPreview] = useState<string>(getImageUrl(initialImageUrl));
  const { toast } = useToast();
  const { showError, DebugOverlayComponent, closeOverlay, isDebugOpen } = useDebugOverlay();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Image must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload file
    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      // Log the request being made for diagnostics
      const requestInfo = {
        url: '/api/upload',
        method: "POST",
        formDataKeys: Array.from(formData.keys()), // Use Array.from to avoid TS iterator issue
        hasImageFile: formData.has('image'),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      };
      console.log("Upload request details:", requestInfo);
      
      // Use our improved apiRequest function from queryClient
      // which handles all the URL construction and CORS headers
      const response = await apiRequest("POST", "/api/upload", undefined, {
        body: formData
      });
      
      const responseInfo = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(Array.from(response.headers.entries())),
        url: response.url,
        redirected: response.redirected,
        type: response.type,
      };
      console.log("Upload response received:", responseInfo);

      if (!response.ok) {
        // Try to get detailed error information from the response
        let errorDetail = "Failed to upload image";
        let errorData = null;
        let responseText = "";
        
        try {
          errorData = await response.json();
          errorDetail = errorData.message || errorData.details || errorDetail;
          console.error("Upload error details:", errorData);
        } catch (parseError) {
          console.error("Could not parse error response:", parseError);
          // If we can't parse the error response, use the status text and full URL
          errorDetail = `Failed to upload image (${response.status}: ${response.statusText})`;
          try {
            responseText = await response.text();
            console.error("Response text:", responseText);
          } catch (e) {
            responseText = "Could not read response text";
            console.error(responseText);
          }
        }
        
        // Show detailed error information in the debug overlay
        showError({
          title: `Upload Failed (${response.status}: ${response.statusText})`,
          message: errorDetail,
          details: responseText || (errorData ? JSON.stringify(errorData, null, 2) : ""),
          requestInfo,
          responseInfo,
          apiUrl: '/api/upload',
          finalApiUrl: response.url
        });
        
        throw new Error(errorDetail);
      }

      const data = await response.json();
      console.log("Upload success response:", data);
      
      // Ensure the URL is properly formatted for both local and cloud images
      const imageUrl = getImageUrl(data.url);
      
      console.log("Formatted image URL for use:", imageUrl);
      onImageUploaded(imageUrl);
      
      toast({
        title: "Image uploaded",
        description: "Your image has been uploaded successfully",
      });
    } catch (error) {
      console.error("Image upload error:", error);
      let errorMessage = "Upload failed";
      let errorDetail = "An unexpected error occurred";
      
      if (error instanceof Error) {
        errorMessage = "Upload failed";
        errorDetail = error.message;
      }
      
      // Always show error in debug overlay for better debugging
      showError({
        title: errorMessage,
        message: errorDetail,
        details: error instanceof Error ? error.stack || "No stack trace available" : "Unknown error",
        requestInfo: {
          url: '/api/upload',
          method: "POST",
          formDataKeys: Array.from(formData.keys())
        },
        responseInfo: {
          error: error instanceof Error ? error.message : String(error)
        },
        apiUrl: '/api/upload'
      });
      
      toast({
        title: errorMessage,
        description: "Check the error details panel for more information",
        variant: "destructive",
      });
      
      // Reset preview if upload fails - ensure URL is properly formatted
      setPreview(getImageUrl(initialImageUrl));
    } finally {
      setIsUploading(false);
    }
  };

  const clearImage = () => {
    setPreview("");
    onImageUploaded("");
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-4">
        <Input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={isUploading}
          className="max-w-sm"
        />

        {isUploading && (
          <div className="flex items-center">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span>Uploading...</span>
          </div>
        )}
      </div>

      {preview && (
        <div className="relative border rounded-md overflow-hidden mt-4">
          <img
            src={getImageUrl(preview)}
            alt="Image preview"
            className="max-h-[300px] w-auto object-contain mx-auto"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
            onClick={clearImage}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!preview && !isUploading && (
        <div className="border border-dashed rounded-md p-8 text-center">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">
            Drag and drop an image or click the browse button above
          </p>
        </div>
      )}
      
      {/* Debug overlay for developer-friendly error information */}
      <DebugOverlayComponent />
    </div>
  );
}