import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useReducer, useCallback, useMemo, useState, useRef } from 'react';
import { View, StyleSheet, Text, Alert, Button } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { io, Socket } from 'socket.io-client';
import MapView, { Marker, Region, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import debounce from 'lodash/debounce';
import { Image, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.04;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;
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
  orderAssigned: boolean;
}
type Action =
  | { type: 'SET_DELIVERY_COORDS'; payload: Coords }
  | { type: 'SET_CUSTOMER_COORDS'; payload: Coords }
  | { type: 'SET_ORDER_STATUS'; payload: string }
  | { type: 'SET_ETA'; payload: string | null }
  | { type: 'SET_ROUTE'; payload: RouteCoord[] }
  | { type: 'SET_ORDER_ASSIGNED'; payload: boolean };
const initialState: State = {
  deliveryCoords: null,
  customerCoords: null,
  orderStatus: 'Pending',
  eta: null,
  routeCoords: [],
  orderAssigned: false,
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
    case 'SET_ORDER_ASSIGNED':
      return { ...state, orderAssigned: action.payload };
    default:
      return state;
  }
};
const SOCKET_URL = 'http://iitr.sainsg.tech';
const TARGET_ORDER_ID = '12345';
const UPDATE_INTERVAL = 5000;
const DEFAULT_REGION: Region = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

export default function CustomerApp(){
    const [state, dispatch] = useReducer(reducer, initialState);
    const DELIVERY_ICON = require('../assets/images/delivery-icon-png.png'); // Place a 32x32 PNG in assets/
    const { deliveryCoords, customerCoords, orderStatus, eta, routeCoords, orderAssigned } = state;
    const [connected, setConnected] = useState<boolean>(false);
    const mapRef = useRef<MapView | null>(null);
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
    const getLocationOfDelivery = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Error', 'Location permission denied');
          return;
        }
        //Delivery Person current location
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const coords:Coords={ 
            latitude:location.coords.latitude,
            longitude:location.coords.longitude,
            latitudeDelta: LATITUDE_DELTA,
            longitudeDelta: LONGITUDE_DELTA};
        dispatch({type:"SET_CUSTOMER_COORDS",payload: coords});
      } catch (error) {
        Alert.alert('Error', `Failed to get location: ${(error as Error).message}`);
      }
    };
    const getLocationOfDestination = async () => {
      try {
            socket.on('customerLocation', (coords: Coords) => {
                dispatch({ type: 'SET_DELIVERY_COORDS', payload: coords });
    });
      } catch (error) {
        Alert.alert('Error', `Failed to get location: ${(error as Error).message}`);
      }
    };
    const handleConnect = () => {
        getLocationOfDelivery();
        getLocationOfDestination();
        if(customerCoords && deliveryCoords) {
        socket.emit('customerLocation', {
            deliveryCoords: deliveryCoords})
            socket.emit('joinOrder')
        }
        else{
            Alert.alert('Error', 'Delivery or Customer coordinates not available');
        }
    }
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
          Alert.alert(notification.request.content.title || 'Notification', notification.request.content.body?.toString());
        });
    
        return () => subscription.remove();
      }, []);

useEffect(() => {
    socket.on('connect', () => {
        setConnected(true);
        console.log('Connected to server');
        console.log('Customer app connected:', socket.id);
        getLocationOfDestination();    
        getLocationOfDelivery();
        socket.on('error',({message}: { message: string }) => {
            Alert.alert('Error', message);
        }
        );
    socket.on('connected', ({ deliveryCoords, customerCoords, routeCoords }: { deliveryCoords: Coords; customerCoords: Coords; routeCoords: RouteCoord[] }) => {
        setConnected(true);
        dispatch({ type: 'SET_CUSTOMER_COORDS', payload: customerCoords });
        dispatch({ type: 'SET_DELIVERY_COORDS', payload: deliveryCoords });
        dispatch({ type: 'SET_ROUTE', payload: routeCoords });
      Alert.alert('Success', 'Connected to customer!');
      if (mapRef.current && routeCoords.length > 0) {
        mapRef.current.fitToCoordinates(routeCoords, {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true,
        });
      }
    });
        })
}, [socket]);
return (
    <View style={styles.container}>
      {orderAssigned ? (
        <>
          <MapView
          ref = {mapRef}
            style={styles.map}
            initialRegion={DEFAULT_REGION}
            showsUserLocation={true}
            provider={PROVIDER_DEFAULT}
            customMapStyle={[{ featureType: 'all', elementType: 'all', stylers: [{ saturation: -20 }] }]}
          >
          {customerCoords && (
  <Marker coordinate={customerCoords} title="Delivery">
    <Image source={DELIVERY_ICON} style={{ width: 32, height: 32 }} />
  </Marker>
)}
            {routeCoords.length > 0 && (
              <Polyline coordinates={routeCoords} strokeColor="blue" strokeWidth={4} />
            )}
            {deliveryCoords && <Marker coordinate={deliveryCoords} pinColor="blue" title="Customer" />}

          </MapView>
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>Order Status: {orderStatus}</Text>
            {eta && orderStatus !== 'Delivered' && <Text style={styles.infoText}>ETA: {eta}</Text>}
          </View>
        </>
      ) : (
        <View style={styles.buttonContainer}>
        <Button 
        title='recieve order ' onPress = {handleConnect} />
        </View>
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

