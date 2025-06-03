import React, { useEffect, useReducer, useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Text, Alert, Button } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { io, Socket } from 'socket.io-client';
import MapView, { Marker, Region, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import debounce from 'lodash/debounce';
import { Image } from 'react-native';

interface Coords {
  latitude: number;
  longitude: number;
}

interface LocationUpdatePayload {
  orderId: string;
  coords: Coords;
}
interface RouteCoord {
  latitude: number;
  longitude: number;
}
// interface OrderStatusPayload {
//   orderId: string;
//   status: string;
// }

// interface RouteUpdatePayload {
//   orderId: string;
//   routeCoords: Coords[];
// }

// interface OrderAssignedPayload {
//   orderId: string;
//   deliveryCoords: Coords;
//   customerCoords: Coords;
//   routeCoords: Coords[];
// }

interface State {
  deliveryCoords: Coords | null;
  customerCoords: Coords | null;
  orderStatus: string;
  eta: string | undefined;
  routeCoords: Coords[];
  orderPlaced: boolean;
}

type Action =
  | { type: 'SET_DELIVERY_COORDS'; payload: Coords }
  | { type: 'SET_CUSTOMER_COORDS'; payload: Coords }
  | { type: 'SET_ORDER_STATUS'; payload: string }
  | { type: 'SET_ETA'; payload: string | undefined }
  | { type: 'SET_ROUTE'; payload: RouteCoord[] }
  | { type: 'SET_ORDER_PLACED'; payload: boolean };

const initialState: State = {
  deliveryCoords: null,
  customerCoords: null,
  orderStatus: 'Pending',
  eta: undefined,
  routeCoords: [],
  orderPlaced: false,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_DELIVERY_COORDS':
      return { ...state, deliveryCoords: action.payload };
    case 'SET_CUSTOMER_COORDS':
      return { ...state, customerCoords: action.payload };
    case 'SET_ORDER_STATUS':
      return { ...state, orderStatus: action.payload };
    case 'SET_ETA':
      return { ...state, eta: action.payload };
    case 'SET_ROUTE':
      return { ...state, routeCoords: action.payload };
    case 'SET_ORDER_PLACED':
      return { ...state, orderPlaced: action.payload };
    default:
      return state;
  }
};

const SOCKET_URL = 'http://iitr.sainsg.tech';
const TARGET_ORDER_ID = '12345';
const UPDATE_INTERVAL = 5000;
const DEFAULT_REGION: Region = {
  latitude: 12.9716,
  longitude: 77.6046,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

// const getDistance = (coord1: Coords, coord2: Coords): number => {
//   const R = 6371e3; // Earth's radius in meters
//   const lat1 = (coord1.latitude * Math.PI) / 180;
//   const lat2 = (coord2.latitude * Math.PI) / 180;
//   const deltaLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
//   const deltaLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;
//   const a =
//     Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
//     Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
//   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//   return R * c;
// };

// const calculateETA = (route: Coords[]): string => {
//   if (route.length < 2) return 'N/A';
//   let totalDistance = 0;
//   for (let i = 0; i < route.length - 1; i++) {
//     totalDistance += getDistance(route[i], route[i + 1]);
//   }
//   const speedKmh = 30; // Average speed: 30 km/h
//   const timeHours = totalDistance / (speedKmh * 1000);
//   const timeMinutes = Math.round(timeHours * 60);
//   return timeMinutes <= 0 ? 'Arrived' : `${timeMinutes} min`;
// };

export default function CustomerApp() {
  const DELIVERY_ICON = require('../assets/images/delivery-icon-png.png'); // Place a 32x32 PNG in assets/
  const [state, dispatch] = useReducer(reducer, initialState);
  const { deliveryCoords, customerCoords, orderStatus, eta, routeCoords, orderPlaced } = state;
  const mapRef = React.useRef<MapView>(null);
  const [socket] = useState<Socket>(() =>
    io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    })
  );

  const sendLocationUpdate = useCallback(
    debounce((coords: Coords) => {
      socket.emit('customerLocationUpdate', { orderId: TARGET_ORDER_ID, coords });
      console.log('📍 Customer location sent:', coords);
    }, 1000),
    [socket]
  );

  const handlePlaceOrder = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is required to place an order.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords: Coords = {
  latitude: 17.3843,
  longitude: 78.4583,
      };
      dispatch({ type: 'SET_CUSTOMER_COORDS', payload: coords });
      socket.emit('joinOrder', ({ routeCoords}:{routeCoords:RouteCoord[] })=>{
        dispatch({ type: 'SET_ROUTE', payload: routeCoords });
      Alert.alert('Success', 'Connected to delivery user!');
      if (mapRef.current && routeCoords.length > 0) {
        mapRef.current.fitToCoordinates(routeCoords, {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true,
        });
      }
      });
      console.log('📦 Order placed with coords:', coords);
    } catch (error) {
      console.error('Error placing order:', error);
      Alert.alert('Error', 'Failed to place order. Please try again.');
    }
  }, [socket]);

  useEffect(() => {
    if (orderPlaced && customerCoords) {
      sendLocationUpdate(customerCoords); // Send static location once
    }
  }, [orderPlaced, customerCoords, sendLocationUpdate]);

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

    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      Alert.alert(notification.request.content.title || 'Notification', notification.request.content.body?.toString());
    });

    return () => subscription.remove();
  }, []);

  const handleDeliveryLocationUpdate = useCallback(
    ({ orderId, coords }: LocationUpdatePayload) => {
      if (orderId === TARGET_ORDER_ID && coords?.latitude && coords?.longitude) {
        dispatch({ type: 'SET_DELIVERY_COORDS', payload: coords });
      }
    },
    []
  );

  // const handleOrderStatusUpdate = useCallback(
  //   ({ orderId, status }: OrderStatusPayload) => {
  //     if (orderId === TARGET_ORDER_ID) {
  //       dispatch({ type: 'SET_ORDER_STATUS', payload: status });
  //       if (status === 'Delivered') {
  //         dispatch({ type: 'SET_ORDER_PLACED', payload: false });
  //         Notifications.scheduleNotificationAsync({
  //           content: {
  //             title: 'Order Delivered!',
  //             body: 'Your order has been delivered successfully.',
  //           },
  //           trigger: null,
  //         });
  //       }
  //     }
  //   },
  //   []
  // );

  // const handleRouteUpdate = useCallback(
  //   ({ orderId, route }: RouteUpdatePayload) => {
  //     if (orderId === TARGET_ORDER_ID) {
  //       dispatch({ type: 'SET_ROUTE', payload: route });
  //     }
  //   },
  //   []
  // );

  // const handleOrderAssigned = useCallback(
  //   ({ orderId, deliveryCoords, routeCoords }: OrderAssignedPayload) => {
  //     if (orderId === TARGET_ORDER_ID) {
  //       dispatch({ type: 'SET_DELIVERY_COORDS', payload: deliveryCoords });
  //       // Avoid overwriting static customerCoords
  //       // dispatch({ type: 'SET_ROUTE', payload: routeCoords });
  //       // dispatch({ type: 'SET_ORDER_PLACED', payload: true });
  //       // dispatch({ type: 'SET_ORDER_STATUS', payload: 'Assigned' });
  //       Notifications.scheduleNotificationAsync({
  //         content: {
  //           title: 'Order Assigned!',
  //           body: 'Your order has been assigned to a delivery person.',
  //         },
  //         trigger: null,
  //       });
  //     }
  //   },
  //   []
  // );

  useEffect(() => {
    socket.on('connect', () => {
      console.log('CustomerApp connected:', socket.id);
      socket.emit('joinOrder', TARGET_ORDER_ID);
    });
    socket.on('connect_error', (error) => {
      console.error('CustomerApp connection error:', error.message);
      Alert.alert('Connection Error', 'Failed to connect to server. Retrying...');
    });
    socket.on('deliveryLocationUpdate', handleDeliveryLocationUpdate);
    // socket.on('orderStatusUpdate', handleOrderStatusUpdate);
    // socket.on('routeUpdate', handleRouteUpdate);
    // socket.on('orderAssigned', handleOrderAssigned);
    // socket.on('orderError', ({ message }) => {
    //   Alert.alert('Order Error', message);
    //   dispatch({ type: 'SET_ORDER_PLACED', payload: false });
    //   dispatch({ type: 'SET_ORDER_STATUS', payload: 'Pending' });
    // });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('deliveryLocationUpdate', handleDeliveryLocationUpdate);
      // socket.off('orderStatusUpdate', handleOrderStatusUpdate);
      // socket.off('routeUpdate', handleRouteUpdate);
      // socket.off('orderAssigned', handleOrderAssigned);
      // socket.off('orderError');
    };
  }, [socket, handleDeliveryLocationUpdate, /*handleOrderStatusUpdate, handleRouteUpdate, handleOrderAssigned*/ ]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (routeCoords.length > 0 && orderStatus !== 'Delivered') {
        // const eta = calculateETA(route);
        dispatch({ type: 'SET_ETA', payload: eta });
        // const distance = getDistance(route[0], route[route.length - 1]);
        // if (distance < 100) {
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'Delivery is Near!',
              body: 'Your delivery is less than 100 meters away.',
            },
            trigger: null,
          });
        // }
      } else {
        dispatch({ type: 'SET_ETA', payload: undefined });
      }
    }, 10000); // Update every 10 seconds for smoother UX

    return () => clearInterval(interval);
  }, [routeCoords, orderStatus]);

  const region = useMemo<Region>(() => {
    if (routeCoords.length > 0) {
      const lats = routeCoords.map((coord) => coord.latitude);
      const lons = routeCoords.map((coord) => coord.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2,
        latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.02),
        longitudeDelta: Math.max((maxLon - minLon) * 1.5, 0.02),
      };
    }
    if (deliveryCoords && customerCoords) {
      const avgLatitude = (deliveryCoords.latitude + customerCoords.latitude) / 2;
      const avgLongitude = (deliveryCoords.longitude + customerCoords.longitude) / 2;
      const latitudeDelta = Math.max(
        Math.abs(deliveryCoords.latitude - customerCoords.latitude) * 1.5,
        0.02
      );
      const longitudeDelta = Math.max(
        Math.abs(deliveryCoords.longitude - customerCoords.longitude) * 1.5,
        0.02
      );
      return { latitude: avgLatitude, longitude: avgLongitude, latitudeDelta, longitudeDelta };
    }
    if (customerCoords) {
      return {
        latitude: customerCoords.latitude,
        longitude: customerCoords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    return DEFAULT_REGION;
  }, [deliveryCoords, customerCoords, routeCoords]);

  return (
    <View style={styles.container}>
      {!orderPlaced ? (
        <View style={styles.buttonContainer}>
          <Button title="Place Order" onPress={handlePlaceOrder} color="#FF6347" />
        </View>
      ) : (
        <>
          <MapView
          ref = {mapRef}
            style={styles.map}
            region={region}
            initialRegion={DEFAULT_REGION}
            showsUserLocation={true}
            provider={PROVIDER_DEFAULT}
            customMapStyle={[{ featureType: 'all', elementType: 'all', stylers: [{ saturation: -20 }] }]}
          >
            {customerCoords && <Marker coordinate={customerCoords} pinColor="blue" title="You" />}
            {routeCoords.length >0 &&(
              <Polyline coordinates={routeCoords} strokeColor="blue" strokeWidth={5} />
            )}
            {deliveryCoords && (
              <Marker coordinate={deliveryCoords} title="Delivery">
                <Image source={DELIVERY_ICON} style={{ width: 32, height: 32 }} />
              </Marker>
            )}
          </MapView>
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>Order Status: {orderStatus}</Text>
            {eta && orderStatus !== 'Delivered' && <Text style={styles.infoText}>ETA: {eta}</Text>}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  map: { ...StyleSheet.absoluteFillObject },
  infoContainer: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  infoText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  buttonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
});
// import React, { useState, useEffect, useRef } from 'react';
// import { View, Text, Button, StyleSheet, Alert, Dimensions } from 'react-native';
// import MapView from 'react-native-maps';
// import { Marker, Polyline } from 'react-native-maps';
// import * as Location from 'expo-location';
// import { SafeAreaView } from 'react-native-safe-area-context';
// import { io, Socket } from 'socket.io-client';

// const { width, height } = Dimensions.get('window');
// const ASPECT_RATIO = width / height;
// const LATITUDE_DELTA = 0.04;
// const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

// interface Coords {
//   latitude: number;
//   longitude: number;
//   latitudeDelta: number;
//   longitudeDelta: number;
// }

// interface RouteCoord {
//   latitude: number;
//   longitude: number;
// }

// const CustomerScreen: React.FC = () => {
//   const [coords, setCoords] = useState<Coords | null>(null);
//   const [deliveryCoords, setDeliveryCoords] = useState<Coords | null>(null);
//   const [routeCoords, setRouteCoords] = useState<RouteCoord[]>([]);
//   const [connected, setConnected] = useState<boolean>(false);
//   const socketRef = useRef<Socket | null>(null);
//   const mapRef = useRef<MapView | null>(null);

//   useEffect(() => {
//     // Connect to backend
//     socketRef.current = io('http://iitr.sainsg.tech');

//     // Handle connection errors
//     socketRef.current.on('error', (message: string) => {
//       Alert.alert('Error', message);
//     });

//     // Handle delivery location
//     socketRef.current.on('deliveryLocation', (coords: Coords) => {
//       setDeliveryCoords(coords);
//     });

//     // Handle successful connection and route
//     socketRef.current.on('connected', ({ deliveryCoords, customerCoords, routeCoords }: { deliveryCoords: Coords; customerCoords: Coords; routeCoords: RouteCoord[] }) => {
//       setConnected(true);
//       setDeliveryCoords(deliveryCoords);
//       setRouteCoords(routeCoords);
//       Alert.alert('Success', 'Connected to delivery user!');
//       if (mapRef.current && routeCoords.length > 0) {
//         mapRef.current.fitToCoordinates(routeCoords, {
//           edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
//           animated: true,
//         });
//       }
//     });

//     // Request location permissions and get current location
//     const getLocation = async () => {
//       try {
//         const { status } = await Location.requestForegroundPermissionsAsync();
//         if (status !== 'granted') {
//           Alert.alert('Error', 'Location permission denied');
//           return;
//         }

//         const location = await Location.getCurrentPositionAsync({
//           accuracy: Location.Accuracy.High,
//         });
//                 const  latitude=17.3843
//         const longitude = 78.4583;
//         setCoords({ latitude, longitude, latitudeDelta: LATITUDE_DELTA, longitudeDelta: LONGITUDE_DELTA });
//       } catch (error) {
//         Alert.alert('Error', `Failed to get location: ${(error as Error).message}`);
//       }
//     };

//     getLocation();

//     return () => {
//       socketRef.current?.disconnect();
//     };
//   }, []);

//   const handleConnect = () => {
//     if (coords && socketRef.current) {
//       socketRef.current.emit('customerLocation', coords);
//       socketRef.current.emit('connectUsers');
//     } else {
//       Alert.alert('Error', 'Location not available yet.');
//     }
//   };

//   return (
//     <SafeAreaView style={styles.container}>
//       {coords ? (
//         <MapView ref={mapRef} style={styles.map} initialRegion={coords}>
//           {coords && <Marker coordinate={coords} title="Your Location" />}
//           {deliveryCoords && <Marker coordinate={deliveryCoords} title="Delivery Location" />}
//           {routeCoords.length > 0 && (
//             <Polyline coordinates={routeCoords} strokeColor="blue" strokeWidth={5} />
//           )}
//         </MapView>
//       ) : (
//         <Text>Loading location...</Text>
//       )}
//       <View style={styles.buttonContainer}>
//         <Button
//           title={connected ? 'Connected' : 'Connect'}
//           onPress={handleConnect}
//           disabled={connected}
//         />
//       </View>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   container: { flex: 1 },
//   map: { flex: 1 },
//   buttonContainer: { padding: 10 },
// });

// export default CustomerScreen;