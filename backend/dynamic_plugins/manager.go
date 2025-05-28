package dynamic_plugins

import (
    "context" // Add this import
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "path/filepath"
    "plugin"
    "strings"
    "sync"

    "github.com/gin-gonic/gin"
    "github.com/google/go-github/v57/github"
    "gopkg.in/yaml.v2"
)

// PluginManager manages dynamic plugin loading and unloading
type PluginManager struct {
    plugins      map[string]*LoadedPlugin
    router       *gin.Engine
    pluginDir    string
    mutex        sync.RWMutex
    githubClient *github.Client
}

// LoadedPlugin represents a loaded plugin instance
type LoadedPlugin struct {
    Plugin   KubestellarPlugin
    Metadata PluginMetadata
    FilePath string
    Routes   []string
}

// NewPluginManager creates a new plugin manager
func NewPluginManager(router *gin.Engine, pluginDir string) *PluginManager {
    return &PluginManager{
        plugins:      make(map[string]*LoadedPlugin),
        router:       router,
        pluginDir:    pluginDir,
        githubClient: github.NewClient(nil),
    }
}

// LoadPluginFromGitHub downloads and loads a plugin from GitHub repository
func (pm *PluginManager) LoadPluginFromGitHub(repoURL string) error {
    log.Printf("Loading plugin from GitHub: %s", repoURL)
    
    // Parse repository URL
    owner, repo, err := parseGitHubURL(repoURL)
    if err != nil {
        return fmt.Errorf("invalid GitHub URL: %v", err)
    }

    // Create context for GitHub API calls
    ctx := context.Background()

    // Get latest release
    release, _, err := pm.githubClient.Repositories.GetLatestRelease(ctx, owner, repo)
    if err != nil {
        return fmt.Errorf("failed to get latest release: %v", err)
    }

    log.Printf("Found release: %s", release.GetTagName())

    // Download plugin manifest
    manifestURL := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/plugin.yaml", 
        owner, repo, release.GetTagName())
    
    manifest, err := pm.downloadManifest(manifestURL)
    if err != nil {
        return fmt.Errorf("failed to download manifest: %v", err)
    }

    // Download plugin binary (.so file)
    binaryPath, err := pm.downloadPluginBinary(release, manifest.ID)
    if err != nil {
        return fmt.Errorf("failed to download plugin binary: %v", err)
    }

    // Load the plugin
    return pm.LoadPlugin(binaryPath, manifest)
}

// LoadPluginFromFile loads a plugin from a local .so file
func (pm *PluginManager) LoadPluginFromFile(pluginPath, manifestPath string) error {
    log.Printf("Loading plugin from local file: %s", pluginPath)
    
    // Read the manifest
    manifestData, err := os.ReadFile(manifestPath)
    if err != nil {
        return fmt.Errorf("failed to read manifest: %v", err)
    }
    
    var manifest PluginMetadata
    if err := yaml.Unmarshal(manifestData, &manifest); err != nil {
        return fmt.Errorf("failed to parse manifest: %v", err)
    }
    
    // Load the plugin
    return pm.LoadPlugin(pluginPath, manifest)
}

// LoadPlugin loads a plugin from a .so file
func (pm *PluginManager) LoadPlugin(pluginPath string, manifest PluginMetadata) error {
    pm.mutex.Lock()
    defer pm.mutex.Unlock()

    log.Printf("Loading plugin: %s from %s", manifest.ID, pluginPath)

    // Check if plugin is already loaded
    if _, exists := pm.plugins[manifest.ID]; exists {
        return fmt.Errorf("plugin %s is already loaded", manifest.ID)
    }

    // Load the plugin
    p, err := plugin.Open(pluginPath)
    if err != nil {
        return fmt.Errorf("failed to open plugin: %v", err)
    }

    // Look up the NewPlugin symbol
    symNewPlugin, err := p.Lookup(PluginSymbol)
    if err != nil {
        return fmt.Errorf("plugin does not export symbol %s: %v", PluginSymbol, err)
    }

    // Cast to the correct function type
    newPluginFunc, ok := symNewPlugin.(func() interface{})
    if !ok {
        return fmt.Errorf("symbol %s is not of type func() interface{}", PluginSymbol)
    }

    // Create plugin instance
    pluginInterface := newPluginFunc()
    pluginInstance, ok := pluginInterface.(KubestellarPlugin)
    if !ok {
        return fmt.Errorf("plugin does not implement KubestellarPlugin interface")
    }

    // Initialize the plugin
    config := make(map[string]interface{})
    if err := pluginInstance.Initialize(config); err != nil {
        return fmt.Errorf("failed to initialize plugin: %v", err)
    }

    // Verify metadata matches
    pluginMeta := pluginInstance.GetMetadata()
    if pluginMeta.ID != manifest.ID {
        return fmt.Errorf("plugin ID mismatch: expected %s, got %s", manifest.ID, pluginMeta.ID)
    }

    // Register routes
    routes := pm.registerPluginRoutes(manifest.ID, pluginInstance)

    // Store loaded plugin
    pm.plugins[manifest.ID] = &LoadedPlugin{
        Plugin:   pluginInstance,
        Metadata: manifest,
        FilePath: pluginPath,
        Routes:   routes,
    }

    log.Printf("Plugin %s loaded successfully with %d routes", manifest.ID, len(routes))
    return nil
}

// registerPluginRoutes registers plugin routes with the Gin router
func (pm *PluginManager) registerPluginRoutes(pluginID string, plugin KubestellarPlugin) []string {
    handlers := plugin.GetHandlers()
    metadata := plugin.GetMetadata()
    var routes []string

    // Create a route group for this plugin
    pluginGroup := pm.router.Group(fmt.Sprintf("/api/plugins/%s", pluginID))

    for _, endpoint := range metadata.Endpoints {
        handlerFunc, exists := handlers[endpoint.Handler]
        if !exists {
            log.Printf("Warning: handler %s not found for endpoint %s", endpoint.Handler, endpoint.Path)
            continue
        }

        // Register the route
        switch strings.ToUpper(endpoint.Method) {
        case "GET":
            pluginGroup.GET(endpoint.Path, handlerFunc)
        case "POST":
            pluginGroup.POST(endpoint.Path, handlerFunc)
        case "PUT":
            pluginGroup.PUT(endpoint.Path, handlerFunc)
        case "DELETE":
            pluginGroup.DELETE(endpoint.Path, handlerFunc)
        default:
            log.Printf("Warning: unsupported method %s for endpoint %s", endpoint.Method, endpoint.Path)
            continue
        }

        route := fmt.Sprintf("%s %s%s", endpoint.Method, fmt.Sprintf("/api/plugins/%s", pluginID), endpoint.Path)
        routes = append(routes, route)
        log.Printf("Registered route: %s", route)
    }

    return routes
}

// UnloadPlugin unloads a plugin
func (pm *PluginManager) UnloadPlugin(pluginID string) error {
    pm.mutex.Lock()
    defer pm.mutex.Unlock()

    loadedPlugin, exists := pm.plugins[pluginID]
    if !exists {
        return fmt.Errorf("plugin %s is not loaded", pluginID)
    }

    // Cleanup plugin
    if err := loadedPlugin.Plugin.Cleanup(); err != nil {
        log.Printf("Warning: plugin cleanup failed: %v", err)
    }

    delete(pm.plugins, pluginID)
    log.Printf("Plugin %s unloaded", pluginID)
    return nil
}

// ListPlugins returns information about all loaded plugins
func (pm *PluginManager) ListPlugins() map[string]PluginMetadata {
    pm.mutex.RLock()
    defer pm.mutex.RUnlock()

    result := make(map[string]PluginMetadata)
    for id, loadedPlugin := range pm.plugins {
        result[id] = loadedPlugin.Metadata
    }
    return result
}

// GetPlugin returns a specific loaded plugin
func (pm *PluginManager) GetPlugin(pluginID string) (*LoadedPlugin, bool) {
    pm.mutex.RLock()
    defer pm.mutex.RUnlock()

    plugin, exists := pm.plugins[pluginID]
    return plugin, exists
}

// Helper functions
func parseGitHubURL(repoURL string) (owner, repo string, err error) {
    repoURL = strings.TrimSuffix(repoURL, ".git")
    
    if strings.Contains(repoURL, "github.com/") {
        parts := strings.Split(repoURL, "github.com/")
        if len(parts) != 2 {
            return "", "", fmt.Errorf("invalid GitHub URL format")
        }
        
        repoParts := strings.Split(parts[1], "/")
        if len(repoParts) < 2 {
            return "", "", fmt.Errorf("invalid repository path")
        }
        
        return repoParts[0], repoParts[1], nil
    }
    
    return "", "", fmt.Errorf("URL does not appear to be a GitHub repository")
}

func (pm *PluginManager) downloadManifest(manifestURL string) (PluginMetadata, error) {
    var manifest PluginMetadata
    
    resp, err := http.Get(manifestURL)
    if err != nil {
        return manifest, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return manifest, fmt.Errorf("failed to download manifest: HTTP %d", resp.StatusCode)
    }

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return manifest, err
    }

    err = yaml.Unmarshal(body, &manifest)
    return manifest, err
}

func (pm *PluginManager) downloadPluginBinary(release *github.RepositoryRelease, pluginID string) (string, error) {
    var assetURL string
    
    // Look for different naming patterns
    possibleNames := []string{
        fmt.Sprintf("%s-linux-amd64.so", pluginID),
        fmt.Sprintf("%s.so", pluginID),
        fmt.Sprintf("%s-darwin-amd64.so", pluginID), // For Mac
    }
    
    for _, asset := range release.Assets {
        assetName := asset.GetName()
        for _, possibleName := range possibleNames {
            if assetName == possibleName {
                assetURL = asset.GetBrowserDownloadURL()
                break
            }
        }
        if assetURL != "" {
            break
        }
    }
    
    if assetURL == "" {
        return "", fmt.Errorf("no compatible binary found in release")
    }

    resp, err := http.Get(assetURL)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return "", fmt.Errorf("failed to download binary: HTTP %d", resp.StatusCode)
    }

    if err := os.MkdirAll(pm.pluginDir, 0755); err != nil {
        return "", err
    }

    pluginPath := filepath.Join(pm.pluginDir, fmt.Sprintf("%s.so", pluginID))
    file, err := os.Create(pluginPath)
    if err != nil {
        return "", err
    }
    defer file.Close()

    _, err = io.Copy(file, resp.Body)
    if err != nil {
        return "", err
    }

    log.Printf("Downloaded plugin binary to: %s", pluginPath)
    return pluginPath, nil
}