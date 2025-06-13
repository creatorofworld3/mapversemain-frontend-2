import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useReducer, useState, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity, Dimensions, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { io, Socket } from 'socket.io-client';
import MapView, { Marker, Region, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Image } from 'react-native';
import { debounce } from 'lodash';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.04;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;
interface ConnectedPayload {
  deliveryCoords: Coords;
  customerCoords: Coords;
  routeCoords: RouteCoord[];
  eta: string | null;
  orderStatus: string;
}

interface OrderStatusUpdate {
  status: string;
  eta: string | null;
}
interface Coords {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface RouteCoord {
  latitude: number;
  longitude: number;
}

interface State {
  deliveryCoords: Coords | null;
  customerCoords: Coords | null;
  orderStatus: string;
  eta: string | null;
  routeCoords: RouteCoord[];
  isConnected: boolean;
  lastLocationUpdate: number;
}

type Action =
    { type:'BATCH_UPDATE';payload: Partial<State>}
  | { type: 'SET_DELIVERY_COORDS'; payload: Coords }
  | { type: 'SET_CUSTOMER_COORDS'; payload: Coords }
  | { type: 'SET_ORDER_STATUS'; payload: string }
  | { type: 'SET_ETA'; payload: string | null }
  | { type: 'SET_ROUTE'; payload: RouteCoord[] }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_LAST_UPDATE'; payload: number };

const initialState: State = {
  deliveryCoords: null,
  customerCoords: null,
  orderStatus: 'Waiting for Connection',
  eta: null,
  routeCoords: [],
  isConnected: false,
  lastLocationUpdate: Date.now(),
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'BATCH_UPDATE':
      return {...state,...action.payload,lastLocationUpdate:Date.now()}
    case 'SET_DELIVERY_COORDS':
      return { ...state, deliveryCoords: action.payload, lastLocationUpdate: Date.now() };
    case 'SET_CUSTOMER_COORDS':
      return { ...state, customerCoords: action.payload };
    case 'SET_ORDER_STATUS':
      return { ...state, orderStatus: action.payload };
    case 'SET_ETA':
      return { ...state, eta: action.payload };
    case 'SET_ROUTE':
      return { ...state, routeCoords: action.payload };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.payload };
    case 'SET_LAST_UPDATE':
      return { ...state, lastLocationUpdate: action.payload };
    default:
      return state;
  }
};

const SOCKET_URL = 'http://192.168.31.20:8085';

const DEFAULT_REGION: Region = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};
export default function CustomerApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const DELIVERY_ICON = require('../assets/images/delivery-icon-png.png');
  const { deliveryCoords, customerCoords, orderStatus, eta, routeCoords, isConnected, lastLocationUpdate } = state;
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [mapViewMode, setMapViewMode] = useState<'overview' | 'delivery' | 'customer'>('overview');
  const [isLocationStale, setIsLocationStale] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const locationUpdateInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const checkLocationFreshness = () => {
      const timeSinceLastUpdate = Date.now() - lastLocationUpdate;
      setIsLocationStale(timeSinceLastUpdate > 30000); // 30 seconds threshold
    };

    const interval = setInterval(checkLocationFreshness, 5000);
    return () => clearInterval(interval);
  }, [lastLocationUpdate]);

  // Request location updates from delivery person
// Replace NodeJS.Timeout with number for React Native
useEffect(() => {
  if (!isConnected || !socketRef.current) return;

  var timeoutId: number;
  let intervalId: number;

  const requestUpdate = () => {
    if (socketRef.current && socketConnected) {
      socketRef.current.emit('requestLocationUpdate');
    }
  };

  requestUpdate();
  
  const updateInterval = AppState.currentState === 'active' ? 10000 : 30000;
  intervalId = setInterval(requestUpdate, updateInterval) as number;

  return () => {
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };
}, [isConnected, socketConnected]);

// Add AppState listener
useEffect(() => {
  const handleAppStateChange = (nextAppState: string) => {
    if (nextAppState === 'background' && socketRef.current) {
      socketRef.current.emit('pauseTracking');
    } else if (nextAppState === 'active' && socketRef.current) {
      socketRef.current.emit('resumeTracking');
    }
  };

  const subscription = AppState.addEventListener('change', handleAppStateChange);
  return () => subscription?.remove();
}, []);
// Change from useMemo to useCallback since it's a function
const getTimeSinceLastUpdate = useCallback((): string => {
  const minutes = Math.floor((Date.now() - lastLocationUpdate) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 minute ago';
  return `${minutes} minutes ago`;
}, [lastLocationUpdate]);



// Debounce expensive operations
const mapCoordinates = useMemo(() => {
  if (!deliveryCoords || !customerCoords) return [];
  return [
    { latitude: deliveryCoords.latitude, longitude: deliveryCoords.longitude },
    { latitude: customerCoords.latitude, longitude: customerCoords.longitude },
    ...routeCoords
  ];
}, [deliveryCoords, customerCoords, routeCoords]);
const debouncedMapFit = useMemo(
  () => debounce(() => {
    if (mapRef.current && mapCoordinates.length >= 2) {
      mapRef.current.fitToCoordinates(mapCoordinates, {
        edgePadding: { top: 100, right: 50, bottom: 350, left: 50 },
        animated: true,
      });
    }
  }, 500),
  [mapCoordinates]
);
const getCurrentLocation = useCallback(async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Error', 'Location permission denied');
      return;
    }

    // Use correct Expo Location options
    const locationPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      // Remove maximumAge - not supported in Expo Location
    });

    // Implement manual timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Location timeout')), 15000);
    });

    const location = await Promise.race([locationPromise, timeoutPromise]) as Location.LocationObject;

    const coords: Coords = {
      // latitude: location.coords.latitude,
      // longitude: location.coords.longitude,
              // latitude: 17.359623,
      latitude:40.68125,
        // longitude: 78.473765,
        longitude:-74.19409,
      latitudeDelta: LATITUDE_DELTA,
      longitudeDelta: LONGITUDE_DELTA,
    };

    dispatch({ type: 'SET_CUSTOMER_COORDS', payload: coords });
    
    if (socketRef.current?.connected) {
      socketRef.current.emit('customerLocation', { 
        customerCoords:{        
        // latitude: 17.359623,
      latitude:40.68125,
        // longitude: 78.473765,
        longitude:-74.19409,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,}  });
    }
  } catch (error) {
    console.error('Location error:', error);
    // Fallback to default location
    const fallbackCoords: Coords = {
      latitude: 17.587686,
      longitude: 78.401865,
      latitudeDelta: LATITUDE_DELTA,
      longitudeDelta: LONGITUDE_DELTA,
    };
    dispatch({ type: 'SET_CUSTOMER_COORDS', payload: fallbackCoords });
  }
}, []);
  // Initialize socket connection
useEffect(() => {
  const socket = io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
    timeout: 20000,
    forceNew: false,
    upgrade: true,
    rememberUpgrade: true,
  });

  socketRef.current = socket;

  // Batch socket event handlers
  const handleConnect = () => {
    console.log('Connected to server:', socket.id);
    setSocketConnected(true);
  };

  const handleDisconnect = () => {
    console.log('Disconnected from server');
    setSocketConnected(false);
    dispatch({ type: 'SET_CONNECTED', payload: false });
  };

  const handleDeliveryLocation = (coords: Coords) => {
    dispatch({ type: 'SET_DELIVERY_COORDS', payload: coords });
  };

  const handleConnected = ({ deliveryCoords, customerCoords, routeCoords, eta, orderStatus }:ConnectedPayload) => {
    // Batch dispatch
    dispatch({ type: 'SET_DELIVERY_COORDS', payload: deliveryCoords });
    dispatch({ type: 'SET_CUSTOMER_COORDS', payload: customerCoords });
    dispatch({ type: 'SET_ROUTE', payload: routeCoords });
    dispatch({ type: 'SET_ORDER_STATUS', payload: orderStatus });
    dispatch({ type: 'SET_CONNECTED', payload: true });
  };

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('joinedAsCustomer', getCurrentLocation);
  socket.on('deliveryLocation', handleDeliveryLocation);
  socket.on('connected', handleConnected);
  socket.on('orderStatusUpdate', ({ status, eta }) => {
    dispatch({ type: 'SET_ORDER_STATUS', payload: status });
    dispatch({ type: 'SET_ETA', payload: eta });
  });

  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('joinedAsCustomer', getCurrentLocation);
    socket.off('deliveryLocation', handleDeliveryLocation);
    socket.off('connected', handleConnected);
    socket.disconnect();
  };
}, [getCurrentLocation]);
  // Auto-fit map to show both endpoints
// Optimize map auto-fit effect
useEffect(() => {
  if (mapRef.current && mapCoordinates.length >= 2 && mapViewMode === 'overview') {
    const timeoutId = setTimeout(() => {
      mapRef.current?.fitToCoordinates(mapCoordinates, {
        edgePadding: { top: 100, right: 50, bottom: 350, left: 50 },
        animated: true,
      });
    }, 300); // Reduced timeout

    return () => clearTimeout(timeoutId);
  }
}, [mapCoordinates, mapViewMode]);

  // Setup notifications
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const subscription = Notifications.addNotificationReceivedListener(notification => {
      Alert.alert(
        notification.request.content.title || 'Notification',
        notification.request.content.body?.toString()
      );
    });

    return () => subscription.remove();
  }, []);



  const handleJoinAsCustomer =() => {
    if (socketRef.current && socketConnected) {
      socketRef.current.emit('joinAsCustomer');
      dispatch({ type: 'SET_ORDER_STATUS', payload: 'Waiting for Delivery Person...' });
    } else {
      Alert.alert('Error', 'Not connected to server');
    }
  };

  const handleMapViewChange = useCallback((mode: 'overview' | 'delivery' | 'customer') => {
    setMapViewMode(mode);
    
    if (mode === 'delivery' && deliveryCoords) {
      mapRef.current?.animateToRegion({
        latitude: deliveryCoords.latitude,
        longitude: deliveryCoords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    } else if (mode === 'customer' && customerCoords) {
      mapRef.current?.animateToRegion({
        latitude: customerCoords.latitude,
        longitude: customerCoords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    } else if (mode === 'overview' && deliveryCoords && customerCoords) {
      const coordinates = [
        { latitude: deliveryCoords.latitude, longitude: deliveryCoords.longitude },
        { latitude: customerCoords.latitude, longitude: customerCoords.longitude },
        ...routeCoords
      ];
      
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 100, right: 50, bottom: 350, left: 50 },
        animated: true,
      });
    }
  },[deliveryCoords,customerCoords,routeCoords]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'In Transit':
        return '#FF9500';
      case 'Picked Up':
        return '#007AFF';
      case 'Delivered':
        return '#34C759';
      default:
        return '#666';
    }
  };
  // Fix AppState listener for proper typing
useEffect(() => {
  const handleAppStateChange = (nextAppState: string) => {
    if (nextAppState === 'background' && socketRef.current) {
      socketRef.current.emit('pauseTracking');
    } else if (nextAppState === 'active' && socketRef.current) {
      socketRef.current.emit('resumeTracking');
    }
  };

  let subscription: any;
  if (Platform.OS === 'ios') {
    subscription = AppState.addEventListener('change', handleAppStateChange);
  } else {
    subscription = AppState.addEventListener('change', handleAppStateChange);
  }
  
  return () => {
    if (subscription) {
      subscription.remove();
    }
  };
}, []);

useEffect(() => {
  return () => {
    // Clear all timeouts and intervals
    if (locationUpdateInterval.current) {
      clearInterval(locationUpdateInterval.current);
    }
    // Disconnect socket properly
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }
  };
}, []);
  return (
    <SafeAreaView style={styles.container}>
      {isConnected ? (
        <>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={DEFAULT_REGION}
            showsMyLocationButton={false}
            showsCompass={true}
            showsTraffic={true}
            showsIndoors={true}
            showsBuildings={true}
            showsScale={true}
            showsUserLocation={true}
            provider={PROVIDER_DEFAULT}
            customMapStyle={[
              { featureType: 'all', elementType: 'all', stylers: [{ saturation: -20 }] },
              { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#E3F2FD' }] },
              { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] }
            ]}
          >
            {customerCoords && (
              <Marker 
                coordinate={customerCoords} 
                pinColor="red" 
                title="Your Location"
                description="Delivery Address"
              />
            )}

            {deliveryCoords && (
              <Marker coordinate={deliveryCoords} title="Delivery Person">
                <View style={styles.deliveryMarker}>
                  <Image source={DELIVERY_ICON} style={styles.deliveryIcon} />
                  {isLocationStale && <View style={styles.staleIndicator} />}
                </View>
              </Marker>
            )}

            {routeCoords.length > 0 && (
              <Polyline 
                coordinates={routeCoords} 
                strokeColor="#007AFF" 
                strokeWidth={4} 
                lineDashPattern={[5, 5]}
              />
            )}
          </MapView>

          {/* Map View Controls */}
          <View style={styles.mapControls}>
            <TouchableOpacity 
              style={[styles.controlButton, mapViewMode === 'overview' && styles.activeControl]}
              onPress={() => handleMapViewChange('overview')}
            >
              <Text style={[styles.controlText, mapViewMode === 'overview' && styles.activeControlText]}>
                Overview
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.controlButton, mapViewMode === 'delivery' && styles.activeControl]}
              onPress={() => handleMapViewChange('delivery')}
            >
              <Text style={[styles.controlText, mapViewMode === 'delivery' && styles.activeControlText]}>
                Delivery
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.controlButton, mapViewMode === 'customer' && styles.activeControl]}
              onPress={() => handleMapViewChange('customer')}
            >
              <Text style={[styles.controlText, mapViewMode === 'customer' && styles.activeControlText]}>
                You
              </Text>
            </TouchableOpacity>
          </View>

          {/* Enhanced Info Container */}
          <View style={styles.infoContainer}>
            <View style={styles.statusRow}>
              <View style={styles.statusContainer}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(orderStatus) }]} />
                <Text style={styles.statusText}>{orderStatus}</Text>
              </View>
              
              {/* {isLocationStale && (
                <View style={styles.connectionStatus}>
                  <View style={styles.warningDot} />
                  <Text style={styles.connectionText}>Connection Issue</Text>
                </View>
              )} */}
            </View>

            {eta && orderStatus !== 'Delivered' && (
              <View style={styles.etaContainer}>
                <Text style={styles.etaLabel}>Estimated Arrival</Text>
                <Text style={styles.etaText}>{eta}</Text>
              </View>
            )}

            <View style={styles.locationUpdateContainer}>
              <Text style={styles.lastUpdateText}>
                Last update: {getTimeSinceLastUpdate()}
              </Text>
              {socketConnected && (
                <TouchableOpacity 
                  style={styles.refreshButton}
                  onPress={() => socketRef.current?.emit('requestLocationUpdate')}
                >
                  <Text style={styles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
              )}
            </View>
            
            {orderStatus === 'Delivered' && (
              <View style={styles.deliveredContainer}>
                <Text style={styles.deliveredText}>🎉 Order Delivered Successfully!</Text>
                <Text style={styles.thankYouText}>Thank you for your order</Text>
              </View>
            )}
          </View>
        </>
      ) : (
        <View style={styles.connectContainer}>
          <View style={styles.connectContent}>
            <Text style={styles.title}>Track Your Order</Text>
            <Text style={styles.subtitle}>
              {socketConnected ? 'Ready to track your delivery' : 'Connecting to server...'}
            </Text>
            
            <View style={styles.statusIndicatorContainer}>
              <View style={[styles.connectionDot, { backgroundColor: socketConnected ? '#34C759' : '#FF3B30' }]} />
              <Text style={styles.statusIndicator}>
                {socketConnected ? 'Connected' : 'Connecting...'}
              </Text>
            </View>
            
            <Text style={styles.orderStatusText}>Status: {orderStatus}</Text>
            
            <TouchableOpacity 
              style={[styles.connectButton, !socketConnected && styles.disabledButton]}
              onPress={handleJoinAsCustomer}
              disabled={!socketConnected}
            >
              <Text style={styles.connectButtonText}>Start Tracking</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FA' 
  },
  map: { 
    ...StyleSheet.absoluteFillObject 
  },
  mapControls: {
    position: 'absolute',
    top: 60,
    right: 20,
    flexDirection: 'column',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  controlButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  activeControl: {
    backgroundColor: '#007AFF',
  },
  controlText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  activeControlText: {
    color: '#FFFFFF',
  },
  deliveryMarker: {
    position: 'relative',
  },
  deliveryIcon: {
    width: 32,
    height: 32,
  },
  staleIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  infoContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF9500',
    marginRight: 6,
  },
  connectionText: {
    fontSize: 12,
    color: '#FF9500',
    fontWeight: '600',
  },
  etaContainer: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  etaLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  etaText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#007AFF',
  },
  locationUpdateContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  lastUpdateText: {
    fontSize: 12,
    color: '#666',
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  deliveredContainer: {
    alignItems: 'center',
    marginTop: 16,
    padding: 16,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
  },
  deliveredText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 5,
  },
  thankYouText: {
    fontSize: 14,
    color: '#666',
  },
  connectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  connectContent: {
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 32,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
    width: '100%',
    maxWidth: 320,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  statusIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusIndicator: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  orderStatusText: {
    fontSize: 14,
    color: '#999',
    marginBottom: 32,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 25,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    width: '100%',
  },
  disabledButton: {
    backgroundColor: '#CCC',
    shadowOpacity: 0,
    elevation: 0,
  },
  connectButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});