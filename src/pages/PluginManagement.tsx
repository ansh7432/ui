import React, { useState } from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  CircularProgress,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  GitHub as GitHubIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  CheckCircle,
  Error as ErrorIcon,
  Download as DownloadIcon,
  CloudDownload,
  Extension as ExtensionIcon,
} from '@mui/icons-material';
import { usePlugins } from '../hooks/usePlugins';
import useTheme from '../stores/themeStore';
import { toast } from 'react-hot-toast';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel = ({ children, value, index, ...other }: TabPanelProps) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`plugin-tabpanel-${index}`}
      aria-labelledby={`plugin-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
};

const PluginManagement: React.FC = () => {
  const theme = useTheme(state => state.theme);
  const {
    loadedPlugins,
    availablePlugins,
    isLoading,
    isInstalling,
    installationProgress,
    installPluginFromGitHub,
    installPluginFromFile,
    removePlugin,
    isPluginLoaded,
    refetchPlugins,
  } = usePlugins();

  const [activeTab, setActiveTab] = useState(0);
  const [repoUrl, setRepoUrl] = useState('');
  const [pluginPath, setPluginPath] = useState('');
  const [manifestPath, setManifestPath] = useState('');
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleInstallFromGitHub = async () => {
    if (!repoUrl.trim()) {
      toast.error('Please enter a repository URL');
      return;
    }

    try {
      await installPluginFromGitHub({ repoUrl: repoUrl.trim() });
      setRepoUrl('');
      setShowInstallDialog(false);
      setSuccessMessage('Plugin installed successfully from GitHub!');
    } catch (error) {
      console.error('Failed to install plugin:', error);
    }
  };

  const handleInstallFromFile = async () => {
    if (!pluginPath.trim() || !manifestPath.trim()) {
      toast.error('Please enter both plugin and manifest paths');
      return;
    }

    try {
      await installPluginFromFile({
        pluginPath: pluginPath.trim(),
        manifestPath: manifestPath.trim(),
      });
      setPluginPath('');
      setManifestPath('');
      setShowFileDialog(false);
      setSuccessMessage('Plugin installed successfully from local file!');
    } catch (error) {
      console.error('Failed to install plugin from file:', error);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    if (window.confirm(`Are you sure you want to uninstall ${pluginId}?`)) {
      try {
        await removePlugin(pluginId);
        setSuccessMessage(`Plugin ${pluginId} uninstalled successfully!`);
      } catch (error) {
        console.error('Failed to uninstall plugin:', error);
      }
    }
  };

  const getStatusChip = (pluginId: string) => {
    const isLoaded = isPluginLoaded(pluginId);
    return (
      <Chip
        icon={isLoaded ? <CheckCircle /> : <ErrorIcon />}
        label={isLoaded ? 'Loaded' : 'Available'}
        color={isLoaded ? 'success' : 'default'}
        size="small"
      />
    );
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="textSecondary">
          Loading plugins...
        </Typography>
      </Box>
    );
  }

  return (
    <Paper
      sx={{
        maxWidth: '100%',
        margin: 'auto',
        p: 3,
        backgroundColor: theme === 'dark' ? '#0F172A' : '#fff',
        boxShadow: theme === 'dark' ? '0px 4px 10px rgba(0, 0, 0, 0.6)' : undefined,
        color: theme === 'dark' ? '#E5E7EB' : 'inherit',
        '& .MuiTypography-root': {
          color: theme === 'dark' ? '#E5E7EB' : undefined,
        },
        '& .MuiChip-root': {
          backgroundColor: theme === 'dark' ? '#374151' : undefined,
          color: theme === 'dark' ? '#E5E7EB' : undefined,
        },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Plugin Management
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: theme === 'dark' ? '#AEBEDF' : 'text.secondary' }}
          >
            Manage dynamic plugins for KubeStellar
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => refetchPlugins()}
            sx={{
              color: theme === 'dark' ? '#E5E7EB' : undefined,
              borderColor: theme === 'dark' ? '#374151' : undefined,
            }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<GitHubIcon />}
            onClick={() => setShowInstallDialog(true)}
          >
            Install from GitHub
          </Button>
          <Button
            variant="outlined"
            startIcon={<ExtensionIcon />}
            onClick={() => setShowFileDialog(true)}
          >
            Install from File
          </Button>
        </Box>
      </Box>

      {/* Installation Progress */}
      {isInstalling && (
        <Alert
          severity="info"
          sx={{
            mb: 3,
            backgroundColor: theme === 'dark' ? 'rgba(41, 98, 255, 0.15)' : undefined,
            color: theme === 'dark' ? '#E5E7EB' : undefined,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography>Installing plugin... {installationProgress}%</Typography>
          </Box>
        </Alert>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label="plugin management tabs"
          sx={{
            '& .MuiTab-root': {
              color: theme === 'dark' ? '#AEBEDF' : undefined,
            },
            '& .Mui-selected': {
              color: theme === 'dark' ? '#E5E7EB' : undefined,
            },
          }}
        >
          <Tab label={`Installed Plugins (${loadedPlugins.length})`} />
          <Tab label={`Available Plugins (${availablePlugins.length})`} />
        </Tabs>
      </Box>

      {/* Installed Plugins Tab */}
      <TabPanel value={activeTab} index={0}>
        {loadedPlugins.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 8,
              textAlign: 'center',
            }}
          >
            <ExtensionIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No plugins installed yet
            </Typography>
            <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
              Install plugins from GitHub or local files to get started.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {loadedPlugins.map(plugin => (
              <Grid item xs={12} md={6} lg={4} key={plugin.ID}>
                <Card
                  sx={{
                    backgroundColor: theme === 'dark' ? '#1E293B' : undefined,
                    border: theme === 'dark' ? '1px solid #374151' : undefined,
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        mb: 2,
                      }}
                    >
                      <Typography variant="h6" component="h3">
                        {plugin.Name}
                      </Typography>
                      {getStatusChip(plugin.ID)}
                    </Box>
                    <Typography
                      variant="body2"
                      color="textSecondary"
                      sx={{
                        mb: 2,
                        color: theme === 'dark' ? '#AEBEDF' : undefined,
                      }}
                    >
                      {plugin.Description}
                    </Typography>
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="textSecondary">
                        Version: {plugin.Version}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="textSecondary">
                        Author: {plugin.Author}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="textSecondary">
                        Endpoints: {plugin.Endpoints.length}
                      </Typography>
                    </Box>
                  </CardContent>
                  <CardActions>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={() => handleUninstall(plugin.ID)}
                    >
                      Uninstall
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </TabPanel>

      {/* Available Plugins Tab */}
      <TabPanel value={activeTab} index={1}>
        {availablePlugins.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 8,
              textAlign: 'center',
            }}
          >
            <CloudDownload sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No plugins available in the registry
            </Typography>
            <Typography variant="body1" color="textSecondary">
              Install plugins manually or check back later.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {availablePlugins.map(plugin => (
              <Grid item xs={12} md={6} lg={4} key={plugin.id}>
                <Card
                  sx={{
                    backgroundColor: theme === 'dark' ? '#1E293B' : undefined,
                    border: theme === 'dark' ? '1px solid #374151' : undefined,
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        mb: 2,
                      }}
                    >
                      <Typography variant="h6" component="h3">
                        {plugin.name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        {plugin.official && (
                          <Chip label="Official" color="primary" size="small" />
                        )}
                        {getStatusChip(plugin.id)}
                      </Box>
                    </Box>
                    <Typography
                      variant="body2"
                      color="textSecondary"
                      sx={{
                        mb: 2,
                        color: theme === 'dark' ? '#AEBEDF' : undefined,
                      }}
                    >
                      {plugin.description}
                    </Typography>
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" color="textSecondary">
                        Version: {plugin.version}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 1 }}>
                      <Typography
                        variant="caption"
                        color="primary"
                        component="a"
                        href={plugin.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ textDecoration: 'none' }}
                      >
                        View on GitHub
                      </Typography>
                    </Box>
                  </CardContent>
                  <CardActions>
                    {isPluginLoaded(plugin.id) ? (
                      <Button size="small" disabled startIcon={<CheckCircle />}>
                        Installed
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<DownloadIcon />}
                        onClick={() => {
                          setRepoUrl(plugin.repoUrl);
                          setShowInstallDialog(true);
                        }}
                        disabled={isInstalling}
                      >
                        Install
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </TabPanel>

      {/* Install from GitHub Dialog */}
      <Dialog
        open={showInstallDialog}
        onClose={() => setShowInstallDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: theme === 'dark' ? '#1E293B' : undefined,
            color: theme === 'dark' ? '#E5E7EB' : undefined,
          },
        }}
      >
        <DialogTitle>Install Plugin from GitHub</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Enter the GitHub repository URL to install a plugin
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Repository URL"
            type="url"
            fullWidth
            variant="outlined"
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/username/plugin-repo"
            sx={{
              '& .MuiOutlinedInput-root': {
                color: theme === 'dark' ? '#E5E7EB' : undefined,
              },
              '& .MuiInputLabel-root': {
                color: theme === 'dark' ? '#AEBEDF' : undefined,
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowInstallDialog(false)}>Cancel</Button>
          <Button
            onClick={handleInstallFromGitHub}
            variant="contained"
            disabled={isInstalling || !repoUrl.trim()}
          >
            {isInstalling ? <CircularProgress size={20} /> : 'Install'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Install from File Dialog */}
      <Dialog
        open={showFileDialog}
        onClose={() => setShowFileDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: theme === 'dark' ? '#1E293B' : undefined,
            color: theme === 'dark' ? '#E5E7EB' : undefined,
          },
        }}
      >
        <DialogTitle>Install Plugin from Local File</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Enter the local file paths to install a plugin
          </Typography>
          <TextField
            margin="dense"
            label="Plugin File Path (.so)"
            type="text"
            fullWidth
            variant="outlined"
            value={pluginPath}
            onChange={e => setPluginPath(e.target.value)}
            placeholder="/path/to/plugin.so"
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                color: theme === 'dark' ? '#E5E7EB' : undefined,
              },
              '& .MuiInputLabel-root': {
                color: theme === 'dark' ? '#AEBEDF' : undefined,
              },
            }}
          />
          <TextField
            margin="dense"
            label="Manifest File Path (.yaml)"
            type="text"
            fullWidth
            variant="outlined"
            value={manifestPath}
            onChange={e => setManifestPath(e.target.value)}
            placeholder="/path/to/plugin.yaml"
            sx={{
              '& .MuiOutlinedInput-root': {
                color: theme === 'dark' ? '#E5E7EB' : undefined,
              },
              '& .MuiInputLabel-root': {
                color: theme === 'dark' ? '#AEBEDF' : undefined,
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFileDialog(false)}>Cancel</Button>
          <Button
            onClick={handleInstallFromFile}
            variant="contained"
            disabled={isInstalling || !pluginPath.trim() || !manifestPath.trim()}
          >
            {isInstalling ? <CircularProgress size={20} /> : 'Install'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Message */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSuccessMessage('')}
          severity="success"
          sx={{
            width: '100%',
            backgroundColor: theme === 'dark' ? '#1E4620' : undefined,
            color: theme === 'dark' ? '#E5E7EB' : undefined,
          }}
        >
          {successMessage}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default PluginManagement;