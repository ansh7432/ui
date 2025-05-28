import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { PluginService } from '../../services/pluginService';

interface ClusterOnboardRequest {
  clusterName: string;
  kubeconfig?: string;
}

interface ClusterDetachRequest {
  clusterName: string;
}

interface ClusterStatus {
  ClusterName: string;
  Status: string;
}

interface ClusterStatusResponse {
  clusters: ClusterStatus[];
  plugin: string;
}

export const useClusterPluginQueries = () => {
  const PLUGIN_ID = 'kubestellar-cluster-plugin';

  // Check if cluster plugin is available
  const useClusterPluginStatus = () => {
    return useQuery({
      queryKey: ['cluster-plugin-status'],
      queryFn: () => PluginService.getPlugin(PLUGIN_ID),
      retry: false,
      refetchInterval: 1000 * 10, // Check every 10 seconds
      select: data => ({
        available: true,
        version: data.plugin.Version,
        routes: data.routes,
      }),
      // Handle errors silently without throwing
      throwOnError: false,
    });
  };

  // Get cluster statuses from plugin
  const useClusterPluginStatuses = () => {
    return useQuery({
      queryKey: ['cluster-plugin-statuses'],
      queryFn: async (): Promise<ClusterStatusResponse> => {
        const data = await PluginService.callPluginEndpoint(PLUGIN_ID, '/status', 'GET');

        // Safe type conversion with proper checking
        const unknownData = data as unknown;
        const typedData = unknownData as ClusterStatusResponse;

        // Type guard and transformation with fallbacks
        return {
          clusters: Array.isArray(typedData.clusters) ? typedData.clusters : [],
          plugin: typeof typedData.plugin === 'string' ? typedData.plugin : PLUGIN_ID,
        };
      },
      enabled: true, // Will fail gracefully if plugin not loaded
      refetchInterval: 1000 * 5, // Refresh every 5 seconds
      retry: false,
      select: (data: ClusterStatusResponse) => data.clusters || [],
      // Silent fail if plugin not available
      throwOnError: false,
    });
  };

  // Onboard cluster via plugin
  const usePluginOnboardCluster = () => {
    return useMutation({
      mutationFn: async (request: ClusterOnboardRequest) => {
        const response = await PluginService.callPluginEndpoint(
          PLUGIN_ID,
          '/onboard',
          'POST',
          request as unknown as Record<string, unknown>
        );
        return response;
      },
      onSuccess: data => {
        const unknownData = data as unknown;
        const message =
          (unknownData as { message?: string }).message || 'Cluster onboarding started';
        toast.success(`Cluster onboarding started via plugin: ${message}`);
        console.log('Plugin onboard response:', data);
      },
      onError: (error: Error) => {
        toast.error(`Plugin onboard failed: ${error.message}`);
        console.error('Plugin onboard error:', error);
      },
    });
  };

  // Detach cluster via plugin
  const usePluginDetachCluster = () => {
    return useMutation({
      mutationFn: async (request: ClusterDetachRequest) => {
        const response = await PluginService.callPluginEndpoint(
          PLUGIN_ID,
          '/detach',
          'POST',
          request as unknown as Record<string, unknown>
        );
        return response;
      },
      onSuccess: data => {
        const unknownData = data as unknown;
        const message =
          (unknownData as { message?: string }).message || 'Cluster detachment started';
        toast.success(`Cluster detachment started via plugin: ${message}`);
        console.log('Plugin detach response:', data);
      },
      onError: (error: Error) => {
        toast.error(`Plugin detach failed: ${error.message}`);
        console.error('Plugin detach error:', error);
      },
    });
  };

  return {
    useClusterPluginStatus,
    useClusterPluginStatuses,
    usePluginOnboardCluster,
    usePluginDetachCluster,
    PLUGIN_ID,
  };
};
