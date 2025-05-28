/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from '../lib/api';

export interface PluginMetadata {
  ID: string;
  Name: string;
  Version: string;
  Description: string;
  Author: string;
  Endpoints: EndpointConfig[];
  Dependencies: string[];
  Permissions: string[];
  Compatibility: Record<string, string>;
}

export interface EndpointConfig {
  Path: string;
  Method: string;
  Handler: string;
}

export interface LoadedPlugin {
  Plugin: Record<string, unknown>;
  Metadata: PluginMetadata;
  FilePath: string;
  Routes: string[];
}

export interface PluginListResponse {
  plugins: Record<string, PluginMetadata>;
  count: number;
}

export interface PluginDetailsResponse {
  plugin: PluginMetadata;
  routes: string[];
  status: string;
}

export interface PluginHealthResponse {
  status: 'healthy' | 'unhealthy';
  pluginId?: string;
  error?: string;
}

export interface AvailablePlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  repoUrl: string;
  official: boolean;
}

export interface PluginDiscoveryResponse {
  available: AvailablePlugin[];
  count: number;
}

export interface LoadPluginFromGitHubRequest {
  repoUrl: string;
  version?: string;
}

export interface LoadPluginFromFileRequest {
  pluginPath: string;
  manifestPath: string;
}

export interface PluginLoadResponse {
  message: string;
  repoUrl?: string;
  pluginPath?: string;
}

export class PluginService {
  static async listPlugins(): Promise<PluginListResponse> {
    const response = await api.get('/api/plugins');
    return response.data;
  }

  static async getPlugin(pluginId: string): Promise<PluginDetailsResponse> {
    const response = await api.get(`/api/plugins/${pluginId}`);
    return response.data;
  }

  static async getPluginHealth(pluginId: string): Promise<PluginHealthResponse> {
    const response = await api.get(`/api/plugins/${pluginId}/health`);
    return response.data;
  }

  static async loadPluginFromGitHub(request: LoadPluginFromGitHubRequest): Promise<PluginLoadResponse> {
    const response = await api.post('/api/plugins/load', request);
    return response.data;
  }

  static async loadPluginFromFile(request: LoadPluginFromFileRequest): Promise<PluginLoadResponse> {
    const response = await api.post('/api/plugins/load-local', request);
    return response.data;
  }

  static async unloadPlugin(pluginId: string): Promise<{ message: string; pluginId: string }> {
    const response = await api.delete(`/api/plugins/${pluginId}`);
    return response.data;
  }

  static async discoverPlugins(): Promise<PluginDiscoveryResponse> {
    const response = await api.get('/api/plugins/discover');
    return response.data;
  }

  // Plugin-specific API calls
  static async callPluginEndpoint(
    pluginId: string, 
    endpoint: string, 
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Use the new endpoint structure
    const url = `/api/plugin-endpoints/${pluginId}${endpoint}`;
    
    try {
      switch (method) {
        case 'GET': {
          const response = await api.get(url);
          return response.data;
        }
        case 'POST': {
          const postResponse = await api.post(url, data);
          return postResponse.data;
        }
        case 'PUT': {
          const putResponse = await api.put(url, data);
          return putResponse.data;
        }
        case 'DELETE': {
          const deleteResponse = await api.delete(url);
          return deleteResponse.data;
        }
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Plugin ${pluginId} or endpoint ${endpoint} not found`);
      } else if (error.response?.status === 400) {
        throw new Error(`Bad request to plugin endpoint: ${error.response?.data?.error || error.message}`);
      } else {
        throw new Error(`Plugin endpoint call failed: ${error.message}`);
      }
    }
  }
}