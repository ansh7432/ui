import { memo, useState, useEffect, useCallback, useRef } from "react";
import { Box, Button, Typography } from "@mui/material";
import { ZoomIn, ZoomOut } from "@mui/icons-material";
import { useReactFlow } from "reactflow";

interface ZoomControlsProps {
  theme: string;
  onToggleCollapse: () => void;
  isCollapsed: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export const ZoomControls = memo<ZoomControlsProps>(({ theme, onToggleCollapse, isCollapsed, onExpandAll, onCollapseAll }) => {
  const { getZoom, setViewport, fitView } = useReactFlow();
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const animatingRef = useRef(false);
  const initializedRef = useRef(false);
  const zoomRatioRef = useRef<number | null>(null);
  const lastZoomOperationRef = useRef<number | null>(null);
  const zoomStabilityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Avoid frequent zoom level updates
  const updateLockRef = useRef(false);

  const snapToStep = useCallback((zoom: number) => {
    const step = 10;
    return Math.round(zoom / step) * step;
  }, []);

  // Initialize zoom ratio on component mount
  useEffect(() => {
    if (!initializedRef.current) {
      const timer = setTimeout(() => {
        try {
          const initialZoom = getZoom();
          
          if (initialZoom && !isNaN(initialZoom) && initialZoom > 0) {
            console.log(`[ZoomControls] Initializing with zoom: ${initialZoom}`);
            zoomRatioRef.current = initialZoom;
            initializedRef.current = true;
            setZoomLevel(100);
          }
        } catch (e) {
          console.error("[ZoomControls] Error during initialization:", e);
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [getZoom]);

  // Update zoom level display based on actual zoom
  const updateZoomLevelDisplay = useCallback(() => {
    if (!initializedRef.current || !zoomRatioRef.current || updateLockRef.current) return;
    
    try {
      const actualZoom = getZoom();
      const normalizedZoom = (actualZoom / zoomRatioRef.current) * 100;
      const snappedZoom = snapToStep(normalizedZoom);
      setZoomLevel(Math.min(Math.max(snappedZoom, 10), 200));
    } catch (e) {
      console.error("[ZoomControls] Error updating zoom display:", e);
    }
  }, [getZoom, snapToStep]);

  // Monitor zoom changes, but don't interfere with user operations
  useEffect(() => {
    // Initial update
    if (!updateLockRef.current) {
      updateZoomLevelDisplay();
    }
    
    // Periodic check to sync display with actual zoom
    const intervalId = setInterval(() => {
      // Only update if we're not in the middle of a user-initiated zoom operation
      if (!animatingRef.current && !updateLockRef.current && 
          (!lastZoomOperationRef.current || (Date.now() - lastZoomOperationRef.current) > 500)) {
        updateZoomLevelDisplay();
      }
    }, 1000);
    
    return () => clearInterval(intervalId);
  }, [getZoom, snapToStep, updateZoomLevelDisplay]);

  const animateZoom = useCallback((targetZoomLevel: number, duration: number = 250) => {
    if (!zoomRatioRef.current) return;
    
    // Lock updates during zoom operation
    updateLockRef.current = true;
    
    try {
      const startZoom = getZoom();
      // Convert from display percentage to actual zoom value
      const targetZoom = (targetZoomLevel / 100) * zoomRatioRef.current;
      
      const startTime = performance.now();
      animatingRef.current = true;
      lastZoomOperationRef.current = Date.now();

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const newZoom = startZoom + (targetZoom - startZoom) * progress;
        
        // Apply the zoom
        setViewport({ zoom: newZoom, x: 0, y: 0 });
        
        // Update display value during animation
        const displayZoom = snapToStep((newZoom / zoomRatioRef.current!) * 100);
        setZoomLevel(Math.min(Math.max(displayZoom, 10), 200));

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          // Ensure the final zoom level is set correctly
          setZoomLevel(targetZoomLevel);
          
          // Release lock after a delay to prevent interference
          if (zoomStabilityTimeoutRef.current) {
            clearTimeout(zoomStabilityTimeoutRef.current);
          }
          
          zoomStabilityTimeoutRef.current = setTimeout(() => {
            animatingRef.current = false;
            updateLockRef.current = false;
            zoomStabilityTimeoutRef.current = null;
          }, 300);
        }
      };

      requestAnimationFrame(step);
    } catch (e) {
      console.error("[ZoomControls] Error during zoom animation:", e);
      animatingRef.current = false;
      updateLockRef.current = false;
    }
  }, [getZoom, setViewport, snapToStep]);

  const handleResetZoom = useCallback(() => {
    if (!initializedRef.current || !zoomRatioRef.current) return;
    animateZoom(100);
  }, [animateZoom]);

  const handleZoomIn = useCallback(() => {
    if (!initializedRef.current) return;
    
    const newZoomLevel = Math.min(zoomLevel + 10, 200);
    animateZoom(newZoomLevel);
  }, [zoomLevel, animateZoom]);

  const handleZoomOut = useCallback(() => {
    if (!initializedRef.current) return;
    
    const newZoomLevel = Math.max(zoomLevel - 10, 10);
    animateZoom(newZoomLevel);
  }, [zoomLevel, animateZoom]);

  const handleFitView = useCallback(() => {
    try {
      // Lock updates during fit view
      updateLockRef.current = true;
      
      fitView({ duration: 250, padding: 0.1 });
      
      // Set zoom level to 100% after fit
      setTimeout(() => {
        // Store the new zoom after fit as our reference
        const newBaseZoom = getZoom();
        if (newBaseZoom && !isNaN(newBaseZoom) && newBaseZoom > 0) {
          zoomRatioRef.current = newBaseZoom;
        }
        
        setZoomLevel(100);
        
        // Release lock after a delay
        setTimeout(() => {
          updateLockRef.current = false;
        }, 300);
      }, 300);
    } catch (e) {
      console.error("[ZoomControls] Error fitting view:", e);
      updateLockRef.current = false;
    }
  }, [fitView, getZoom]);

  return (
    <Box
      sx={{
        position: "absolute",
        top: 20,
        left: 20,
        display: "flex",
        gap: 1,
        background: theme === "dark" ? "#333" : "#fff",
        padding: "4px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
        borderRadius: "4px",
        zIndex: 10,
      }}
    >
      <Button
        variant="text"
        onClick={onToggleCollapse}
        title="Group By Resource/Kind"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          backgroundColor: isCollapsed ? (theme === "dark" ? "#555" : "#e3f2fd") : "transparent",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <i className="fa fa-object-group fa-fw" style={{ fontSize: "17px" }} />
      </Button>
      <Button
        variant="text"
        onClick={onExpandAll}
        title="Expand all the child nodes of all parent nodes"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <i className="fa fa-plus fa-fw" style={{ fontSize: "17px" }} />
      </Button>
      <Button
        variant="text"
        onClick={onCollapseAll}
        title="Collapse all the child nodes of all parent nodes"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <i className="fa fa-minus fa-fw" style={{ fontSize: "17px" }} />
      </Button>
      <Button
        variant="text"
        onClick={handleResetZoom}
        title="Reset Zoom to 100%"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <i className="fa fa-home fa-fw" style={{ fontSize: "17px" }} />
      </Button>
      <Button
        variant="text"
        onClick={handleFitView}
        title="Fit View"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <i className="fa fa-arrows-alt fa-fw" style={{ fontSize: "16px" }} />
      </Button>
      <Button
        variant="text"
        onClick={handleZoomIn}
        title="Zoom In"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <ZoomIn />
      </Button>
      <Button
        variant="text"
        onClick={handleZoomOut}
        title="Zoom Out"
        sx={{
          color: theme === "dark" ? "#fff" : "#6d7f8b",
          "&:hover": {
            backgroundColor: theme === "dark" ? "#555" : "#e3f2fd",
          },
          minWidth: "36px",
          padding: "4px",
        }}
      >
        <ZoomOut />
      </Button>
      <Typography
        variant="body1"
        sx={{
          border: `2px solid ${theme === "dark" ? "#ccc" : "#1976d2"}`,
          backgroundColor: theme === "dark" ? "#444" : "#e3f2fd",
          color: theme === "dark" ? "#fff" : "#000",
          padding: "4px 8px",
          textAlign: "center",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "50px",
          borderRadius: "3px",
        }}
      >
        {zoomLevel}%
      </Typography>
    </Box>
  );
});