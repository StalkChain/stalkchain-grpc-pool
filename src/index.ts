/**
 * stalkchain-grpc-pool - Main exports
 *
 * Simple gRPC pool for connecting to 3 Solana endpoints and streaming
 * transaction signatures. Clean API that handles all complexity internally.
 *
 * @module stalkchain-grpc-pool
 * @author StalkChain Team
 * @version 1.1.2
 */

export { GrpcPool } from './lib/pool';
export { 
  PoolConfig, 
  PoolOptions, 
  PoolEndpoint, 
  SubscribeRequest, 
  TransactionFilter, 
  AccountFilter,
  TransactionEvent,
  DuplicateEvent,
  EndpointEvent
} from './types';
export { CommitmentLevel, DEFAULT_CONFIG } from './constants'; 