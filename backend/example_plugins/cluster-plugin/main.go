package main

import (
    "context"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "sync"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/kubestellar/ui/dynamic_plugins"
    "github.com/kubestellar/ui/k8s"
    "github.com/kubestellar/ui/models"
    certificatesv1 "k8s.io/api/certificates/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/apimachinery/pkg/types"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/tools/clientcmd"
    clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// ClusterPlugin implements the KubestellarPlugin interface for cluster operations
type ClusterPlugin struct {
    clusterStatuses map[string]string
    mutex          sync.RWMutex
    initialized    bool
}

// Initialize initializes the cluster plugin
func (cp *ClusterPlugin) Initialize(config map[string]interface{}) error {
    if cp.initialized {
        return fmt.Errorf("plugin already initialized")
    }

    cp.clusterStatuses = make(map[string]string)
    cp.initialized = true
    
    log.Println("Cluster plugin initialized successfully")
    return nil
}

// GetMetadata returns plugin metadata
func (cp *ClusterPlugin) GetMetadata() dynamic_plugins.PluginMetadata {
    return dynamic_plugins.PluginMetadata{
        ID:          "kubestellar-cluster-plugin",
        Name:        "KubeStellar Cluster Management",
        Version:     "1.0.0",
        Description: "Plugin for cluster onboarding and detachment operations",
        Author:      "CNCF LFX Mentee",
        Endpoints: []dynamic_plugins.EndpointConfig{
            {Path: "/onboard", Method: "POST", Handler: "OnboardClusterHandler"},
            {Path: "/detach", Method: "POST", Handler: "DetachClusterHandler"},
            {Path: "/status", Method: "GET", Handler: "GetClusterStatusHandler"},
        },
        Dependencies: []string{"kubectl", "clusteradm"},
        Permissions:  []string{"cluster.read", "cluster.write"},
    }
}

// GetHandlers returns the plugin's HTTP handlers
func (cp *ClusterPlugin) GetHandlers() map[string]gin.HandlerFunc {
    return map[string]gin.HandlerFunc{
        "OnboardClusterHandler":     cp.OnboardClusterHandler,
        "DetachClusterHandler":      cp.DetachClusterHandler,
        "GetClusterStatusHandler":   cp.GetClusterStatusHandler,
    }
}

// Health performs a health check
func (cp *ClusterPlugin) Health() error {
    if !cp.initialized {
        return fmt.Errorf("plugin not initialized")
    }
    return nil
}

// Cleanup performs cleanup operations
func (cp *ClusterPlugin) Cleanup() error {
    cp.initialized = false
    log.Println("Cluster plugin cleaned up")
    return nil
}

// OnboardClusterHandler handles cluster onboarding requests
func (cp *ClusterPlugin) OnboardClusterHandler(c *gin.Context) {
    log.Println("Plugin: Handling cluster onboarding request")
    
    contentType := c.GetHeader("Content-Type")
    var kubeconfigData []byte
    var clusterName string
    var useLocalKubeconfig bool = false

    // Handle different content types
    if strings.Contains(contentType, "multipart/form-data") {
        file, fileErr := c.FormFile("kubeconfig")
        clusterName = c.PostForm("name")

        if clusterName != "" && (fileErr != nil || file == nil) {
            useLocalKubeconfig = true
        } else if fileErr != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to retrieve kubeconfig file"})
            return
        } else if clusterName == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error": "Cluster name is required"})
            return
        } else {
            f, err := file.Open()
            if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open kubeconfig file"})
                return
            }
            defer f.Close()

            kubeconfigData, err = io.ReadAll(f)
            if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read kubeconfig file"})
                return
            }
        }
    } else if strings.Contains(contentType, "application/json") {
        var req struct {
            Kubeconfig  string `json:"kubeconfig"`
            ClusterName string `json:"clusterName"`
        }

        if err := c.BindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
            return
        }

        clusterName = req.ClusterName
        if clusterName == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error": "ClusterName is required"})
            return
        }

        if req.Kubeconfig == "" {
            useLocalKubeconfig = true
        } else {
            kubeconfigData = []byte(req.Kubeconfig)
        }
    } else {
        clusterName = c.Query("name")
        if clusterName == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error": "Cluster name parameter is required"})
            return
        }
        useLocalKubeconfig = true
    }

    // Get kubeconfig from local if needed
    if useLocalKubeconfig {
        var err error
        kubeconfigData, err = cp.getClusterConfigFromLocal(clusterName)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to find cluster '%s' in local kubeconfig: %v", clusterName, err)})
            return
        }
    }

    // Check if cluster is already being onboarded
    cp.mutex.Lock()
    if status, exists := cp.clusterStatuses[clusterName]; exists {
        cp.mutex.Unlock()
        c.JSON(http.StatusOK, gin.H{
            "message": fmt.Sprintf("Cluster '%s' is already onboarded (status: %s)", clusterName, status),
            "status":  status,
            "plugin":  "kubestellar-cluster-plugin",
        })
        return
    }
    cp.clusterStatuses[clusterName] = "Pending"
    cp.mutex.Unlock()

    // Start asynchronous onboarding
    go func() {
        err := cp.onboardCluster(kubeconfigData, clusterName)
        cp.mutex.Lock()
        if err != nil {
            log.Printf("Plugin: Cluster '%s' onboarding failed: %v", clusterName, err)
            cp.clusterStatuses[clusterName] = "Failed"
        } else {
            cp.clusterStatuses[clusterName] = "Onboarded"
            log.Printf("Plugin: Cluster '%s' onboarded successfully", clusterName)
        }
        cp.mutex.Unlock()
    }()

    c.JSON(http.StatusOK, gin.H{
        "message": fmt.Sprintf("Cluster '%s' is being onboarded via plugin", clusterName),
        "status":  "Pending",
        "plugin":  "kubestellar-cluster-plugin",
    })
}

// DetachClusterHandler handles cluster detachment requests
func (cp *ClusterPlugin) DetachClusterHandler(c *gin.Context) {
    log.Println("Plugin: Handling cluster detachment request")
    
    var req struct {
        ClusterName string `json:"clusterName" binding:"required"`
    }

    if err := c.BindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload, clusterName is required"})
        return
    }

    clusterName := req.ClusterName
    if clusterName == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Cluster name is required"})
        return
    }

    // Start asynchronous detachment
    go func() {
        err := cp.detachCluster(clusterName)
        cp.mutex.Lock()
        if err != nil {
            log.Printf("Plugin: Cluster '%s' detachment failed: %v", clusterName, err)
            cp.clusterStatuses[clusterName] = "DetachFailed"
        } else {
            delete(cp.clusterStatuses, clusterName)
            log.Printf("Plugin: Cluster '%s' detached successfully", clusterName)
        }
        cp.mutex.Unlock()
    }()

    c.JSON(http.StatusOK, gin.H{
        "message": fmt.Sprintf("Cluster '%s' is being detached via plugin", clusterName),
        "plugin":  "kubestellar-cluster-plugin",
    })
}

// GetClusterStatusHandler returns the status of all clusters
func (cp *ClusterPlugin) GetClusterStatusHandler(c *gin.Context) {
    cp.mutex.Lock()
    defer cp.mutex.Unlock()

    var statuses []models.ClusterStatus
    for cluster, status := range cp.clusterStatuses {
        statuses = append(statuses, models.ClusterStatus{
            ClusterName: cluster,
            Status:      status,
        })
    }

    c.JSON(http.StatusOK, gin.H{
        "clusters": statuses,
        "plugin":   "kubestellar-cluster-plugin",
    })
}

// Core onboarding logic (extracted from handlers.go)
func (cp *ClusterPlugin) onboardCluster(kubeconfigData []byte, clusterName string) error {
    log.Printf("Plugin: Starting onboarding for cluster %s", clusterName)

    // 1. Validate cluster connectivity
    if err := cp.validateClusterConnectivity(kubeconfigData); err != nil {
        return fmt.Errorf("cluster validation failed: %w", err)
    }

    // 2. Get ITS hub context
    itsContext := "its1"
    hubClientset, _, err := k8s.GetClientSetWithConfigContext(itsContext)
    if err != nil {
        return fmt.Errorf("failed to get hub clientset: %w", err)
    }

    // 3. Create temporary kubeconfig
    tempPath, err := cp.createTempKubeconfig(kubeconfigData, clusterName)
    if err != nil {
        return fmt.Errorf("failed to create temp kubeconfig: %w", err)
    }
    defer os.Remove(tempPath)

    // 4. Get join token
    joinToken, err := cp.getClusterAdmToken(itsContext)
    if err != nil {
        return fmt.Errorf("failed to get token: %w", err)
    }

    // 5. Join cluster to hub
    if err := cp.joinClusterToHub(tempPath, clusterName, joinToken); err != nil {
        return fmt.Errorf("failed to join cluster: %w", err)
    }

    // 6. Approve CSRs
    if err := cp.approveClusterCSRs(hubClientset, clusterName); err != nil {
        return fmt.Errorf("failed to approve CSRs: %w", err)
    }

    // 7. Wait for managed cluster
    if err := cp.waitForManagedCluster(hubClientset, clusterName); err != nil {
        return fmt.Errorf("failed to confirm managed cluster creation: %w", err)
    }

    log.Printf("Plugin: Cluster '%s' onboarded successfully", clusterName)
    return nil
}

// Simplified detachment logic
func (cp *ClusterPlugin) detachCluster(clusterName string) error {
    log.Printf("Plugin: Starting detachment for cluster %s", clusterName)

    itsContext := "its1"
    hubClientset, _, err := k8s.GetClientSetWithConfigContext(itsContext)
    if err != nil {
        return fmt.Errorf("failed to get hub clientset: %w", err)
    }

    // Delete the managed cluster
    deleteResult := hubClientset.RESTClient().Delete().
        AbsPath("/apis/cluster.open-cluster-management.io/v1").
        Resource("managedclusters").
        Name(clusterName).
        Do(context.TODO())

    if err := deleteResult.Error(); err != nil {
        return fmt.Errorf("failed to delete managed cluster: %w", err)
    }

    log.Printf("Plugin: Cluster '%s' detached successfully", clusterName)
    return nil
}

// Helper functions (simplified versions from handlers.go)
func (cp *ClusterPlugin) getClusterConfigFromLocal(clusterName string) ([]byte, error) {
    kubeconfig := cp.kubeconfigPath()
    config, err := clientcmd.LoadFromFile(kubeconfig)
    if err != nil {
        return nil, fmt.Errorf("failed to load kubeconfig: %v", err)
    }

    cluster, exists := config.Clusters[clusterName]
    if !exists {
        return nil, fmt.Errorf("cluster '%s' not found in local kubeconfig", clusterName)
    }

    newConfig := clientcmdapi.Config{
        APIVersion: "v1",
        Kind:       "Config",
        Clusters: map[string]*clientcmdapi.Cluster{
            clusterName: cluster,
        },
        Contexts: map[string]*clientcmdapi.Context{
            clusterName: {
                Cluster:  clusterName,
                AuthInfo: "default-user",
            },
        },
        AuthInfos:      map[string]*clientcmdapi.AuthInfo{},
        CurrentContext: clusterName,
    }

    return clientcmd.Write(newConfig)
}

func (cp *ClusterPlugin) validateClusterConnectivity(kubeconfigData []byte) error {
    config, err := clientcmd.RESTConfigFromKubeConfig(kubeconfigData)
    if err != nil {
        return fmt.Errorf("failed to parse kubeconfig: %w", err)
    }

    client, err := kubernetes.NewForConfig(config)
    if err != nil {
        return fmt.Errorf("failed to create Kubernetes client: %w", err)
    }

    _, err = client.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})
    if err != nil {
        return fmt.Errorf("failed to connect to the cluster: %w", err)
    }

    return nil
}

func (cp *ClusterPlugin) getClusterAdmToken(hubContext string) (string, error) {
    cmd := exec.Command("clusteradm", "--context", hubContext, "get", "token")
    output, err := cmd.CombinedOutput()
    if err != nil {
        return "", fmt.Errorf("failed to get token: %s, %w", string(output), err)
    }

    outputStr := string(output)
    for _, line := range strings.Split(outputStr, "\n") {
        if strings.HasPrefix(line, "clusteradm join") {
            return line, nil
        }
    }

    return "", fmt.Errorf("join command not found in output: %s", outputStr)
}

func (cp *ClusterPlugin) createTempKubeconfig(kubeconfigData []byte, clusterName string) (string, error) {
    tempDir := os.TempDir()
    tempFile := filepath.Join(tempDir, fmt.Sprintf("kubeconfig-%s-%d", clusterName, time.Now().UnixNano()))

    config, err := clientcmd.Load(kubeconfigData)
    if err != nil {
        return "", fmt.Errorf("invalid kubeconfig format: %w", err)
    }

    if err := clientcmd.WriteToFile(*config, tempFile); err != nil {
        return "", fmt.Errorf("failed to write temporary kubeconfig: %w", err)
    }

    return tempFile, nil
}

func (cp *ClusterPlugin) joinClusterToHub(kubeconfigPath, clusterName, joinToken string) error {
    joinCmd := strings.Replace(joinToken, "<cluster_name>", clusterName, 1)
    cmdParts := strings.Fields(joinCmd)
    cmdParts = append(cmdParts, "--context", clusterName, "--singleton", "--force-internal-endpoint-lookup")

    cmd := exec.Command(cmdParts[0], cmdParts[1:]...)
    cmd.Env = append(os.Environ(), fmt.Sprintf("KUBECONFIG=%s", kubeconfigPath))

    output, err := cmd.CombinedOutput()
    if err != nil {
        return fmt.Errorf("join command failed: %s, %w", string(output), err)
    }

    log.Printf("Join command output: %s", string(output))
    return nil
}

func (cp *ClusterPlugin) approveClusterCSRs(clientset *kubernetes.Clientset, clusterName string) error {
    log.Printf("Plugin: Approving CSRs for cluster %s", clusterName)

    time.Sleep(30 * time.Second)

    csrList, err := clientset.CertificatesV1().CertificateSigningRequests().List(context.TODO(), metav1.ListOptions{})
    if err != nil {
        return fmt.Errorf("failed to list CSRs: %w", err)
    }

    pendingCSRs := []string{}
    for _, csr := range csrList.Items {
        if strings.Contains(csr.Name, clusterName) && !cp.isCSRApproved(csr) {
            pendingCSRs = append(pendingCSRs, csr.Name)
        }
    }

    if len(pendingCSRs) > 0 {
        approveCmd := exec.Command("kubectl", append([]string{"--context", "its1", "certificate", "approve"}, pendingCSRs...)...)
        output, err := approveCmd.CombinedOutput()
        if err != nil {
            log.Printf("Plugin: kubectl approve failed: %v, %s", err, string(output))
            return cp.approveCSRsWithSDK(clientset, pendingCSRs)
        }
        log.Printf("Plugin: CSRs approved with kubectl: %s", string(output))
    }

    return nil
}

func (cp *ClusterPlugin) approveCSRsWithSDK(clientset *kubernetes.Clientset, csrNames []string) error {
    for _, csrName := range csrNames {
        approvalPatch := []byte(`{"status":{"conditions":[{"type":"Approved","status":"True","reason":"ApprovedByPlugin","message":"Approved via KubeStellar Plugin"}]}}`)

        _, err := clientset.CertificatesV1().CertificateSigningRequests().Patch(
            context.TODO(),
            csrName,
            types.MergePatchType,
            approvalPatch,
            metav1.PatchOptions{},
        )
        if err != nil {
            return fmt.Errorf("failed to approve CSR %s: %w", csrName, err)
        }
        log.Printf("Plugin: Approved CSR %s", csrName)
    }
    return nil
}

func (cp *ClusterPlugin) isCSRApproved(csr certificatesv1.CertificateSigningRequest) bool {
    for _, condition := range csr.Status.Conditions {
        if condition.Type == certificatesv1.CertificateApproved {
            return true
        }
    }
    return false
}

func (cp *ClusterPlugin) waitForManagedCluster(clientset *kubernetes.Clientset, clusterName string) error {
    timeout := time.After(5 * time.Minute)
    tick := time.Tick(10 * time.Second)

    log.Printf("Plugin: Waiting for managed cluster %s to be created...", clusterName)

    for {
        select {
        case <-timeout:
            return fmt.Errorf("timeout waiting for managed cluster")
        case <-tick:
            result := clientset.RESTClient().Get().
                AbsPath("/apis/cluster.open-cluster-management.io/v1").
                Resource("managedclusters").
                Name(clusterName).
                Do(context.TODO())

            if err := result.Error(); err == nil {
                log.Printf("Plugin: Managed cluster %s created", clusterName)

                acceptPatch := []byte(`{"spec":{"hubAcceptsClient":true}}`)
                patchResult := clientset.RESTClient().Patch(types.MergePatchType).
                    AbsPath("/apis/cluster.open-cluster-management.io/v1").
                    Resource("managedclusters").
                    Name(clusterName).
                    Body(acceptPatch).
                    Do(context.TODO())

                if patchErr := patchResult.Error(); patchErr != nil {
                    log.Printf("Plugin: Warning - Failed to accept managed cluster: %v", patchErr)
                } else {
                    log.Printf("Plugin: Managed cluster %s accepted", clusterName)
                }

                return nil
            }
        }
    }
}

func (cp *ClusterPlugin) kubeconfigPath() string {
    if path := os.Getenv("KUBECONFIG"); path != "" {
        return path
    }
    home, err := os.UserHomeDir()
    if err != nil {
        log.Fatalf("Unable to get user home directory: %v", err)
    }
    return fmt.Sprintf("%s/.kube/config", home)
}

// NewPlugin creates a new instance of the cluster plugin
// This is the required symbol that will be looked up when loading the plugin
func NewPlugin() interface{} {
    return &ClusterPlugin{}
}